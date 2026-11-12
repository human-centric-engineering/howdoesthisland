# Workspaces

A workspace is a Sunrise org (D1). Everyone works in one: their own from
signup, and any team workspaces they make or are invited into. This page is
the app's side; the org model itself is core's
([`../tenancy/identity.md`](../tenancy/identity.md)).

## Where each piece lives

| Piece                                    | Where                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| A workspace of one's own at signup (t-7) | `lib/app/signup-org.ts` → `lib/app/workspaces/provision.ts`              |
| Sweeping signup workspaces nobody joined | `lib/app/workspaces/sweep.ts`, registered in `lib/app/jobs.ts`           |
| Creating a team workspace (t-8)          | `POST /api/v1/workspaces` → `lib/app/workspaces/create.ts`               |
| Switching workspace                      | `components/app/workspaces/workspace-switcher.tsx`, in the header's slot |
| Members and invitations                  | `/settings/workspace` (`app/(protected)/settings/workspace/page.tsx`)    |

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
the create cannot share a transaction, so the count is taken again once the
org exists and before it is granted anything: a create that raced past the cap
is erased (`eraseOrg`, in a system scope) and refused the same way. Creates
that race each other may all undo themselves; the person is left under the cap
to try again.

## The routes the UI uses are core's

The switcher reads `GET /api/v1/orgs` and switches with
`POST /api/v1/orgs/switch`. The settings page reads
`GET /api/v1/orgs/[id]/members` and renders core's own `MembersTable` (role
change, removal) and `MemberInviteForm` (invite, re-send a pending one), the
components core's `/admin/members` uses. It adds no rule of its own. Core
admits only a workspace's `OWNER` or `ADMIN` to the roster and invitations, so
a `MEMBER` is told to ask one of them instead. The page exists so a workspace
owner manages people inside the app's frame rather than in `/admin`.

Core's invitation refuses an address that already has an account. Since every
signup gets a workspace, most teammates will have one: inviting them is t-9.

## At `TENANCY_MODE=single`

There is one shared org and nothing to switch between: the slot renders
nothing, `/settings/workspace` is not found, and `POST /api/v1/workspaces`
answers 400 `WORKSPACES_UNAVAILABLE`.
