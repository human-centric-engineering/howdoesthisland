# Workspaces

A workspace is a Sunrise org (D1). Everyone works in one: their own from
signup, and any team workspaces they make or are invited into. This page is
the app's side; the org model itself is core's
([`../tenancy/identity.md`](../tenancy/identity.md)).

## Where each piece lives

| Piece                                    | Where                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A workspace of one's own at signup (t-7) | `lib/app/signup-org.ts` → `lib/app/workspaces/provision.ts`                                     |
| Sweeping signup workspaces nobody joined | `lib/app/workspaces/sweep.ts`, registered in `lib/app/jobs.ts`                                  |
| Creating a team workspace (t-8)          | `POST /api/v1/workspaces` → `lib/app/workspaces/create.ts`                                      |
| Switching workspace                      | `components/app/workspaces/workspace-switcher.tsx`, in the header's slot                        |
| Members and invitations                  | `/settings/workspace` (`app/(protected)/settings/workspace/page.tsx`)                           |
| Inviting, account or not (t-9)           | `POST /api/v1/workspaces/[id]/invitations` → `lib/app/workspaces/invitations.ts`                |
| Answering an invitation (t-9)            | `GET /api/v1/workspaces/invitations`, `POST …/invitations/[invitationId]/accept` and `/decline` |

## What every new workspace gets

Both kinds go through `equipWorkspace()` in `provision.ts`, so they cannot
drift: OpenAI approved, a $10 monthly budget (owner ruling under D6), and the
platform agents reconciled again once the grant exists. A step that fails is
logged at `error` and the workspace is still created; a platform admin can
finish it on `/admin`.

They differ in who joins and when. A signup workspace is created before the
user row exists and joined by the signup-org seam, so it carries a marker the
sweep reads until someone has joined. A team workspace is created with its
`OWNER` in the same transaction, so it is never memberless and never marked.

## The cap

A person may own at most `MAX_OWNED_WORKSPACES` (10, in
`lib/app/workspaces/validations.ts`), their own included. It counts `OWNER`
memberships outside the install org, not workspaces created, so it needs no
record of who made what: handing a workspace over frees a place. Past it,
`POST /api/v1/workspaces` answers 409 `WORKSPACE_LIMIT_REACHED`. The count and
the create cannot share a transaction, so once the org exists, and before it
is granted anything, the person's owned workspaces are ranked by when they
became owner. One ranked past the cap is erased (`eraseOrg`, in a system
scope) and refused the same way, so of two racing creates the earlier keeps
its place. In a narrow commit-order window both can stay, leaving the person
one over; closing that needs a per-person lock this tier cannot take.

## The routes the UI uses are core's

The switcher reads `GET /api/v1/orgs` and switches with
`POST /api/v1/orgs/switch`. The settings page reads
`GET /api/v1/orgs/[id]/members` and renders core's own `MembersTable` (role
change, removal), the component core's `/admin/members` uses. Inviting is the
app's own route and form (below). It adds no rule of its own. Core
admits only a workspace's `OWNER` or `ADMIN` to the roster and invitations, so
a `MEMBER` is told to ask one of them instead. The page exists so a workspace
owner manages people inside the app's frame rather than in `/admin`.

## Inviting people (t-9)

Since every signup gets a workspace, most teammates already have an account.
Core's org invitation refuses those addresses with a 409 that says so, and
core's add-by-id adds someone without asking them. So the settings page uses
the app's `WorkspaceInviteForm` and `POST /api/v1/workspaces/[id]/invitations`
instead, which take both:

- **An address with an account** gets a `WorkspaceInvitation` row (14 days)
  and an email pointing at `/settings/workspace`, where they accept or
  decline it. Accepting adds them through core's `addMember()` with the invited
  role, and switches them into the workspace.
- **An address without one** gets core's sign-up invitation
  (`deliverInvitation`, 7 days), under the same rules core's route applies.

**The answer never says which.** Every case answers 202 with the same body,
including the ones where nothing is sent (already a member, the service
account, a sign-up invitation pending into another org). Both sending branches
send one email, so they take about as long. Errors are only ever about the
caller or the workspace: who may invite is core's policy (the workspace's
owners and admins, acting in it), and what may be invited is core's
`checkInvitationInto` (only an owner invites an owner; not the install org;
not a suspended workspace). Core's own route still answers 409 for an existing
account; the upstream issue asks for that to change.

One row per person per workspace: re-inviting someone who declined, let it
lapse or left reopens it. An invitation is claimed before `addMember()` runs,
so it is used once however many requests race, and the claim is undone if
core refuses for any reason but "already a member".

The invitee reads their invitations across workspaces they are not in, so
those reads run in the system scope, filtered by their own id; another
person's invitation id is answered as not found. The model is tenant-owned
(row isolation, the org export, cascade with the workspace); the invitee's
rows go with their account and the inviter's id is cleared (hand-written FKs,
drift-probed). Pending, declined and lapsed rows are not swept: there is one
per person per workspace, and they go with either.

## At `TENANCY_MODE=single`

There is one shared org and nothing to switch between: the slot renders
nothing, `/settings/workspace` is not found, and `POST /api/v1/workspaces`
answers 400 `WORKSPACES_UNAVAILABLE`.
