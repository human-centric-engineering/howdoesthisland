'use client';

/**
 * A workspace's webhooks, for its owners and admins (t-100): add one, see
 * them with their last delivery, switch one on or off, give it a new signing
 * secret, delete it, and read its recent deliveries. Over t-99's routes only:
 * `GET`/`POST /api/v1/workspaces/[id]/event-subscriptions`, `PATCH`/`DELETE
 * …/[subscriptionId]`, `POST …/rotate-secret` and `GET …/deliveries`.
 *
 * **A secret is shown once**, in a dialog that holds the only copy this page
 * has: closing it drops the value from state, so it is gone from the page.
 * Only its own buttons close it, never a click outside or Escape, so a
 * stray press cannot lose a secret nobody copied yet.
 * A second secret can't be made while one is showing, so none is lost
 * unseen.
 *
 * The list arrives with each webhook's last delivery, so no row fetches its
 * own; a row's recent deliveries load when someone opens them.
 *
 * Shaped like the MCP-keys panel (`mcp-keys-manager.tsx`) on the workspace's
 * settings, so the two read alike.
 */

import { Fragment, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, Copy } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClientDate } from '@/components/ui/client-date';
import { FieldHelp } from '@/components/ui/field-help';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { useCommittedDialog } from '@/lib/hooks/use-committed-dialog';
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';
import {
  APP_EVENT_TYPES,
  ASSESSMENT_FINISHED,
  MAX_SUBSCRIPTIONS_PER_WORKSPACE,
  type AppEventType,
} from '@/lib/app/events/types';
import { WEBHOOKS_DOCS_HREF } from '@/components/app/developers/webhooks';
import {
  createdSecretSchema,
  createdSubscriptionSchema,
  deliveriesEndpoint,
  deliveryListSchema,
  deliveryStatusLabel,
  deliveryStatusVariant,
  EVENT_LABELS,
  RECENT_DELIVERIES,
  rotatedSecretSchema,
  rotateSecretEndpoint,
  subscriptionEndpoint,
  subscriptionsEndpoint,
  updatedSubscriptionSchema,
  type DeliveryRow,
  type ProjectChoice,
  type SubscriptionRow,
} from '@/components/app/settings/webhooks/schemas';

export interface WebhooksManagerProps {
  orgId: string;
  initialSubscriptions: SubscriptionRow[];
  /** The workspace's projects a webhook can be limited to: its live ones. */
  projects: ProjectChoice[];
}

const NAME_MAX = 100;
const URL_MAX = 2048;
/** The project choice that means "every project". Not a cuid, so never a project's id. */
const WHOLE_WORKSPACE = 'all';

type Shown = { name: string; secret: string; rotated: boolean };
type Deliveries =
  { state: 'loading' } | { state: 'failed' } | { state: 'loaded'; items: DeliveryRow[] };

export function WebhooksManager({ orgId, initialSubscriptions, projects }: WebhooksManagerProps) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);

  const [name, setName] = useState('');
  const [eventType, setEventType] = useState<AppEventType>(ASSESSMENT_FINISHED);
  const [url, setUrl] = useState('');
  const [projectId, setProjectId] = useState(WHOLE_WORKSPACE);
  const [creating, setCreating] = useState(false);
  const create = useSaveFailure({
    fallback: 'The webhook could not be added. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  // The only copy of a secret this page holds. Closing its dialog drops it.
  const [shown, setShown] = useState<Shown | null>(null);
  const { copied, copy } = useCopyToClipboard();
  const [copyFailed, setCopyFailed] = useState(false);

  // Each switch waits on its own request, so one finishing never frees another.
  const [toggling, setToggling] = useState<ReadonlySet<string>>(new Set());
  const toggle = useSaveFailure({
    fallback: 'The webhook could not be switched. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const remove = useSaveFailure({
    fallback: 'The webhook could not be deleted. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });
  const deleteDialog = useCommittedDialog({
    open: deleteId !== null,
    pending: deleting,
    onClose: () => setDeleteId(null),
    clear: remove.clear,
  });

  const [rotateId, setRotateId] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const rotate = useSaveFailure({
    fallback: 'A new secret could not be made. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });
  const rotateDialog = useCommittedDialog({
    open: rotateId !== null,
    pending: rotating,
    onClose: () => setRotateId(null),
    clear: rotate.clear,
  });

  const [status, setStatus] = useState<string | null>(null);
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Deliveries>>({});
  // The latest load per webhook: an earlier, slower answer must not replace it.
  const deliveryRequests = useRef<Record<string, number>>({});

  const atLimit = subscriptions.length >= MAX_SUBSCRIPTIONS_PER_WORKSPACE;
  const projectName = (id: string | null): string =>
    id === null
      ? 'Whole workspace'
      : // Not among the live projects the page read: archived, or past the
        // first page of them. Neither is certain, so the label claims neither.
        (projects.find((p) => p.id === id)?.name ?? 'A project not listed here');

  const showSecret = (next: Shown) => {
    setCopyFailed(false);
    setShown(next);
  };

  const submit = async () => {
    const problems = [
      ...(name.trim() ? [] : [{ field: 'webhook-name', message: 'Give the webhook a name.' }]),
      ...(url.trim().startsWith('https://')
        ? []
        : [{ field: 'webhook-url', message: 'Give a full address, starting https://' }]),
    ];
    if (create.block(problems)) return;

    setStatus(null);
    setCreating(true);
    let sent: unknown;
    try {
      sent = await apiClient.post<unknown>(subscriptionsEndpoint(orgId), {
        body: {
          name: name.trim(),
          eventType,
          url: url.trim(),
          ...(projectId === WHOLE_WORKSPACE ? {} : { projectId }),
        },
      });
    } catch (err) {
      create.report(err);
      return;
    } finally {
      setCreating(false);
    }

    // The webhook exists from here on, so nothing below may say "try again":
    // that would make a second one.
    setName('');
    setUrl('');
    setProjectId(WHOLE_WORKSPACE);
    const made = createdSubscriptionSchema.safeParse(sent);
    if (made.success) {
      const row = { ...made.data.subscription, lastDelivery: null };
      setSubscriptions((all) => [row, ...all]);
      showSecret({ name: row.name, secret: made.data.secret, rotated: false });
      return;
    }
    const raw = createdSecretSchema.safeParse(sent);
    if (raw.success) showSecret({ name: name.trim(), secret: raw.data.secret, rotated: false });
    create.show(
      raw.success
        ? 'The webhook was added, but this page could not list it. Copy its secret, then reload to see it.'
        : 'The webhook was added, but this page could not read its secret. Reload, then give it a new secret to see one.'
    );
  };

  const handleToggle = async (row: SubscriptionRow, isEnabled: boolean) => {
    setStatus(null);
    setToggling((ids) => new Set(ids).add(row.id));
    toggle.clear();
    try {
      const sent = await apiClient.patch<unknown>(subscriptionEndpoint(orgId, row.id), {
        body: { isEnabled },
      });
      const parsed = updatedSubscriptionSchema.safeParse(sent);
      const next = parsed.success ? parsed.data.subscription.isEnabled : isEnabled;
      setSubscriptions((all) => all.map((s) => (s.id === row.id ? { ...s, isEnabled: next } : s)));
      setStatus(`“${row.name}” is ${next ? 'on' : 'off'}.`);
    } catch (err) {
      toggle.report(err);
    } finally {
      setToggling((ids) => {
        const next = new Set(ids);
        next.delete(row.id);
        return next;
      });
    }
  };

  const handleDelete = async (row: SubscriptionRow) => {
    setDeleting(true);
    try {
      await apiClient.delete(subscriptionEndpoint(orgId, row.id));
      setSubscriptions((all) => all.filter((s) => s.id !== row.id));
      setDeleteId(null);
      if (openDeliveries === row.id) setOpenDeliveries(null);
      setStatus(`Deleted “${row.name}”.`);
    } catch (err) {
      remove.report(err);
    } finally {
      setDeleting(false);
    }
  };

  const handleRotate = async (row: SubscriptionRow) => {
    setRotating(true);
    let sent: unknown;
    try {
      sent = await apiClient.post<unknown>(rotateSecretEndpoint(orgId, row.id));
    } catch (err) {
      rotate.report(err);
      return;
    } finally {
      setRotating(false);
    }
    // The old secret is gone from here on, whatever the answer reads as.
    setRotateId(null);
    const parsed = rotatedSecretSchema.safeParse(sent);
    if (parsed.success) {
      showSecret({ name: row.name, secret: parsed.data.secret, rotated: true });
    } else {
      setStatus(
        `“${row.name}” has a new secret, but this page could not read it. Give it a new secret again to see one.`
      );
    }
  };

  const loadDeliveries = async (id: string) => {
    const request = (deliveryRequests.current[id] ?? 0) + 1;
    deliveryRequests.current[id] = request;
    const settle = (next: Deliveries) => {
      if (deliveryRequests.current[id] !== request) return;
      setDeliveries((all) => ({ ...all, [id]: next }));
    };
    settle({ state: 'loading' });
    try {
      const sent = await apiClient.get<unknown>(deliveriesEndpoint(orgId, id), {
        params: { limit: RECENT_DELIVERIES },
      });
      const parsed = deliveryListSchema.safeParse(sent);
      settle(parsed.success ? { state: 'loaded', items: parsed.data } : { state: 'failed' });
    } catch {
      settle({ state: 'failed' });
    }
  };

  const toggleDeliveries = (id: string) => {
    if (openDeliveries === id) {
      setOpenDeliveries(null);
      return;
    }
    setOpenDeliveries(id);
    // Each opening reads afresh: deliveries change while the page is open.
    void loadDeliveries(id);
  };

  return (
    <div className="space-y-8">
      <Dialog
        open={shown !== null}
        onOpenChange={(open) => {
          if (!open) setShown(null);
        }}
      >
        {shown ? (
          <DialogContent
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>
                {shown.rotated ? 'New signing secret' : 'Signing secret'} for &ldquo;{shown.name}
                &rdquo;
              </DialogTitle>
              <DialogDescription className="text-amber-700 dark:text-amber-400">
                Copy it now and keep it with your receiver. It won&rsquo;t be shown again: once you
                close this, the only way to see a secret is to give the webhook a new one.
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted rounded-md p-3">
              <code className="text-sm break-all" data-testid="webhook-secret">
                {shown.secret}
              </code>
            </div>
            <p className="text-muted-foreground text-sm">
              {shown.rotated
                ? 'Your receiver should accept both the old secret and this one for a minute, while every server switches over.'
                : 'Every delivery is signed with it, so your receiver can check that a message came from this workspace.'}{' '}
              <Link href={WEBHOOKS_DOCS_HREF} className="underline underline-offset-2">
                How to check a signature
              </Link>
              .
            </p>
            <DialogFooter className="flex-wrap items-center gap-3 sm:justify-between">
              <p className="flex items-center gap-2 text-sm" role="status">
                {copied ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    Copied.
                  </>
                ) : copyFailed ? (
                  <>Couldn&rsquo;t copy it here. Select the secret and copy it yourself.</>
                ) : null}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copy(shown.secret).then((ok) => setCopyFailed(!ok))}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy secret
                </Button>
                <Button type="button" onClick={() => setShown(null)}>
                  I&rsquo;ve saved it
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a webhook</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="post"
            noValidate
            className="space-y-5"
            onSubmit={create.submit(async (e) => {
              e?.preventDefault();
              await submit();
            })}
          >
            <div className="space-y-2">
              <Label htmlFor="webhook-name" className="flex items-center gap-1">
                Name
                <FieldHelp title="Naming a webhook">
                  <p>
                    Something that tells you where it sends, like &ldquo;CMS publish queue&rdquo;.
                    It is shown in the list below. Your receiver never sees it.
                  </p>
                </FieldHelp>
              </Label>
              <Input
                id="webhook-name"
                name="webhook-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-event" className="flex items-center gap-1">
                Send when
                <FieldHelp title="What is sent, and when">
                  <p>
                    <strong>A review finishes</strong>: each time a review in this workspace ends,
                    whether it completed, failed or was cancelled.
                  </p>
                  <p>
                    <strong>A comparison finishes</strong>: each time every draft of a comparison
                    has been reviewed and the comparison has its verdict.
                  </p>
                  <p>
                    The message says which review or comparison it was, how it ended and its scores.
                    It never holds the copy itself: your receiver reads the rest from the API by its
                    id. A review you ran with nothing kept sends nothing.
                  </p>
                </FieldHelp>
              </Label>
              <Select
                value={eventType}
                onValueChange={(value) => {
                  const choice = APP_EVENT_TYPES.find((t) => t === value);
                  if (choice) setEventType(choice);
                }}
              >
                <SelectTrigger id="webhook-event" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APP_EVENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {EVENT_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-url" className="flex items-center gap-1">
                Address
                <FieldHelp title="Where it is sent">
                  <p>
                    The address of your receiver, starting <code>https://</code>. It must be on the
                    public internet: an address on a private network is refused.
                  </p>
                  <p>
                    Each message is a signed <code>POST</code>. Answer it with a <code>2xx</code>{' '}
                    within 10 seconds; anything else is tried twice more, after 10 seconds and after
                    a minute. A message can arrive twice, so use its <code>eventId</code> to ignore
                    a repeat.
                  </p>
                  <p>
                    <Link href={WEBHOOKS_DOCS_HREF} className="underline underline-offset-2">
                      Read how to receive one
                    </Link>
                    , with code that checks the signature.
                  </p>
                </FieldHelp>
              </Label>
              <Input
                id="webhook-url"
                name="webhook-url"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={url}
                maxLength={URL_MAX}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-project" className="flex items-center gap-1">
                Project
                <FieldHelp title="Limiting it to one project">
                  <p>
                    Choose a project to send only its reviews and comparisons. Leave it on the whole
                    workspace to send every one, in any project or none.
                  </p>
                  <p>Archived projects are not listed: they take no new reviews.</p>
                </FieldHelp>
              </Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="webhook-project" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE_WORKSPACE}>Whole workspace</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* One unsaved secret at a time: a second would replace the dialog,
                and the first could never be shown again. */}
            <Button type="submit" disabled={creating || shown !== null || atLimit}>
              {creating ? 'Adding the webhook…' : 'Add webhook'}
            </Button>
            {atLimit ? (
              <p className="text-muted-foreground text-sm">
                A workspace can have {MAX_SUBSCRIPTIONS_PER_WORKSPACE} webhooks. Delete one to add
                another.
              </p>
            ) : null}
            <SaveError failure={create.failure} />
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="flex items-center gap-1 text-lg font-semibold">
          This workspace&rsquo;s webhooks
          <FieldHelp title="How a delivery is signed">
            <p>
              Each delivery carries <code>X-Sunrise-Timestamp</code> and{' '}
              <code>X-Sunrise-Signature</code>: an HMAC-SHA256 of the timestamp, a full stop and the
              raw body, keyed with the webhook&rsquo;s secret. Check it against the body before you
              parse it, and refuse an old timestamp.
            </p>
            <p>
              <Link href={WEBHOOKS_DOCS_HREF} className="underline underline-offset-2">
                See the developer docs
              </Link>{' '}
              for code that does it.
            </p>
          </FieldHelp>
        </h2>
        <p role="status" className="text-sm">
          {status}
        </p>
        <SaveError failure={toggle.failure} />
        {subscriptions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No one has added a webhook here yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Sends when</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Last delivery</TableHead>
                <TableHead>On</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((row) => (
                <Fragment key={row.id}>
                  <TableRow>
                    <TableCell className="font-medium">
                      {row.name}
                      <span className="text-muted-foreground block text-xs">
                        {projectName(row.projectId)}
                      </span>
                    </TableCell>
                    <TableCell>{EVENT_LABELS[row.eventType]}</TableCell>
                    <TableCell>
                      <code className="text-xs break-all">{row.url}</code>
                    </TableCell>
                    <TableCell>
                      {row.lastDelivery ? (
                        <span className="space-y-1">
                          <Badge variant={deliveryStatusVariant(row.lastDelivery.status)}>
                            {deliveryStatusLabel(row.lastDelivery.status)}
                          </Badge>
                          <span className="text-muted-foreground block text-xs">
                            <ClientDate date={row.lastDelivery.createdAt} showTime />
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Nothing sent yet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.isEnabled}
                        disabled={toggling.has(row.id)}
                        onCheckedChange={(next) => void handleToggle(row, next)}
                        aria-label={`Send to ${row.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-expanded={openDeliveries === row.id}
                          aria-controls={`deliveries-${row.id}`}
                          onClick={() => toggleDeliveries(row.id)}
                        >
                          {openDeliveries === row.id ? 'Hide deliveries' : 'Deliveries'}
                          <span className="sr-only"> of {row.name}</span>
                        </Button>

                        <AlertDialog
                          open={rotateId === row.id}
                          onOpenChange={rotateDialog.onOpenChange}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={shown !== null}
                              onClick={() => setRotateId(row.id)}
                            >
                              New secret<span className="sr-only"> for {row.name}</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Give &ldquo;{row.name}&rdquo; a new secret?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Deliveries are signed with the new secret within a minute, and the
                                old one stops working. Have your receiver ready to take the new one.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <SaveError failure={rotate.failure} />
                            <AlertDialogFooter>
                              <AlertDialogCancel {...rotateDialog.cancelProps}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                {...rotateDialog.actionProps()}
                                onClick={(e) => rotateDialog.confirm(e, () => handleRotate(row))}
                              >
                                {rotating ? 'Making the secret…' : 'Make a new secret'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        <AlertDialog
                          open={deleteId === row.id}
                          onOpenChange={deleteDialog.onOpenChange}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setDeleteId(row.id)}
                            >
                              Delete<span className="sr-only"> {row.name}</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete &ldquo;{row.name}&rdquo;?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Nothing more is sent to it, within a minute. This can&rsquo;t be
                                undone: to send there again, add a new webhook, which has a new
                                secret.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <SaveError failure={remove.failure} />
                            <AlertDialogFooter>
                              <AlertDialogCancel {...deleteDialog.cancelProps}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                {...deleteDialog.actionProps()}
                                onClick={(e) => deleteDialog.confirm(e, () => handleDelete(row))}
                              >
                                {deleting ? 'Deleting…' : 'Delete'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                  {openDeliveries === row.id ? (
                    <TableRow>
                      <TableCell colSpan={6} id={`deliveries-${row.id}`}>
                        <RecentDeliveries
                          name={row.name}
                          deliveries={deliveries[row.id] ?? { state: 'loading' }}
                          onRetry={() => void loadDeliveries(row.id)}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function RecentDeliveries({
  name,
  deliveries,
  onRetry,
}: {
  name: string;
  deliveries: Deliveries;
  onRetry: () => void;
}) {
  if (deliveries.state === 'loading') {
    return <p className="text-muted-foreground text-sm">Loading the deliveries…</p>;
  }
  if (deliveries.state === 'failed') {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        The deliveries of &ldquo;{name}&rdquo; could not be loaded.
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </p>
    );
  }
  if (deliveries.items.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing has been sent to it yet.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {deliveries.items.length === 1
          ? 'The last delivery'
          : `The last ${deliveries.items.length} deliveries`}{' '}
        to &ldquo;{name}&rdquo;
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Response</TableHead>
            <TableHead>Event id</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.items.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <ClientDate date={d.createdAt} showTime />
              </TableCell>
              <TableCell>
                <Badge variant={deliveryStatusVariant(d.status)}>
                  {deliveryStatusLabel(d.status)}
                </Badge>
                {d.status === 'failed' && d.nextRetryAt ? (
                  <span className="text-muted-foreground block text-xs">
                    Next try <ClientDate date={d.nextRetryAt} showTime />
                  </span>
                ) : null}
              </TableCell>
              <TableCell>{d.attempts}</TableCell>
              <TableCell>
                {d.lastResponseCode !== null ? (
                  <code className="text-xs">{d.lastResponseCode}</code>
                ) : d.lastError ? (
                  <span className="text-xs">No answer: {d.lastError}</span>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell>
                <code className="text-xs break-all">{d.eventId ?? '—'}</code>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
