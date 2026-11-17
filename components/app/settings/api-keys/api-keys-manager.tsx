'use client';

/**
 * Making, listing and revoking your own API keys (t-43), over core's
 * self-service routes: `POST /api/v1/user/api-keys` mints, `GET` lists, and
 * `DELETE …/{keyId}` revokes. Both writes need a browser session, which this
 * page always is.
 *
 * Only the app's scopes are offered (`offeredScopes`). A new key's value is
 * shown once, in a panel that stays until it is dismissed; the API cannot
 * return it again. The rule on what a key may do is the API's, not this
 * page's: the page shows what the server says and nothing more.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Copy } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ClientDate } from '@/components/ui/client-date';
import { FieldHelp } from '@/components/ui/field-help';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  API_KEYS_ENDPOINT,
  apiKeyEndpoint,
  EXPIRY_CHOICES,
  expiresAtFor,
  keyState,
  mintedApiKeySchema,
  mintedRawKeySchema,
  offeredScopes,
  SCOPE_DESCRIPTIONS,
  scopeLabel,
  type ApiKeyRow,
  type ExpiryChoice,
} from '@/components/app/settings/api-keys/schemas';

export interface ApiKeysManagerProps {
  initialKeys: ApiKeyRow[];
  /** What the install can mint; the page offers the app's scopes among them. */
  availableScopes: string[];
  /**
   * The workspace a new key acts in, or `null` when there is none to name
   * (one shared organisation, or the active one could not be read).
   */
  workspaceName: string | null;
  /**
   * When the server rendered the page (ISO). Each key's Active/Expired state
   * is read against it, so the server and the browser draw the same badge.
   */
  renderedAt: string;
}

const NAME_MAX = 200;

const STATE_LABELS = { active: 'Active', expired: 'Expired', revoked: 'Revoked' } as const;

export function ApiKeysManager({
  initialKeys,
  availableScopes,
  workspaceName,
  renderedAt,
}: ApiKeysManagerProps) {
  const scopes = offeredScopes(availableScopes);
  const [keys, setKeys] = useState(initialKeys);

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>(() =>
    scopes.includes('assess') ? ['assess'] : []
  );
  const [expiry, setExpiry] = useState<ExpiryChoice>('90');
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ name: string; rawKey: string } | null>(null);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const create = useSaveFailure({
    fallback: 'The key could not be made. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokedName, setRevokedName] = useState<string | null>(null);
  const keysHeading = useRef<HTMLHeadingElement>(null);
  const revoke = useSaveFailure({
    fallback: 'The key could not be revoked. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });
  const revokeDialog = useCommittedDialog({
    open: revokeId !== null,
    pending: revoking,
    onClose: () => setRevokeId(null),
    clear: revoke.clear,
  });

  const toggleScope = (scope: string, on: boolean) =>
    setPicked((all) => (on ? [...all, scope] : all.filter((s) => s !== scope)));

  const submit = async () => {
    const problems: Array<{ field: string; message: string }> = [];
    if (!name.trim()) problems.push({ field: 'api-key-name', message: 'Give the key a name.' });
    if (picked.length === 0)
      problems.push({
        field: `api-key-scope-${scopes[0]}`,
        message: 'Choose at least one thing it can do.',
      });
    if (create.block(problems)) return;

    setCreating(true);
    let sent: unknown;
    try {
      const expiresAt = expiresAtFor(expiry, new Date());
      sent = await apiClient.post<unknown>(API_KEYS_ENDPOINT, {
        body: { name: name.trim(), scopes: picked, ...(expiresAt ? { expiresAt } : {}) },
      });
    } catch (err) {
      create.report(err);
      return;
    } finally {
      setCreating(false);
    }

    // The key exists from here on, so no failure below may say "try again":
    // that would mint a second key whose value nobody holds.
    setName('');
    setCopied(null);
    const minted = mintedApiKeySchema.safeParse(sent);
    if (minted.success) {
      const { rawKey, ...row } = minted.data.key;
      setKeys((all) => [{ ...row, lastUsedAt: null, revokedAt: null }, ...all]);
      setShown({ name: row.name, rawKey });
      return;
    }
    const raw = mintedRawKeySchema.safeParse(sent);
    if (raw.success) setShown(raw.data.key);
    create.show(
      raw.success
        ? 'The key was made, but this page could not add it to the list. Copy its value above, then reload to see it listed.'
        : 'The key was made, but this page could not read it back. Reload to see it listed, and revoke it, since its value cannot be shown again.'
    );
  };

  const copy = async (rawKey: string) => {
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  const handleRevoke = async (keyId: string) => {
    setRevoking(true);
    try {
      await apiClient.delete(apiKeyEndpoint(keyId));
      const at = new Date().toISOString();
      setKeys((all) =>
        all.map((k) => (k.id === keyId ? { ...k, revokedAt: k.revokedAt ?? at } : k))
      );
      setRevokeId(null);
      setRevokedName(keys.find((k) => k.id === keyId)?.name ?? null);
    } catch (err) {
      revoke.report(err);
    } finally {
      setRevoking(false);
    }
  };

  // A revoked row loses its Revoke button and dialog together, so focus has
  // nowhere to return; send it to the list's heading, where the status line
  // says what happened. After Radix's own deferred restore, hence the timer.
  useEffect(() => {
    if (revokedName === null) return;
    const timer = setTimeout(() => keysHeading.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [revokedName]);

  const now = new Date(renderedAt);

  return (
    <div className="space-y-6">
      {shown ? (
        <Card className="border-amber-500/60">
          <CardHeader>
            <CardTitle className="text-lg">Your new key: {shown.name}</CardTitle>
            <CardDescription className="text-amber-700 dark:text-amber-400">
              Copy it now and keep it somewhere safe. We don&rsquo;t keep it, so it can&rsquo;t be
              shown again: if you lose it, revoke it and make another.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-muted rounded-md p-3">
              <code className="text-sm break-all" data-testid="new-api-key">
                {shown.rawKey}
              </code>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copy(shown.rawKey)}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy key
              </Button>
              <Button type="button" size="sm" onClick={() => setShown(null)}>
                I&rsquo;ve saved it
              </Button>
              {copied === 'yes' ? (
                <p className="flex items-center gap-2 text-sm" role="status">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  Copied.
                </p>
              ) : copied === 'failed' ? (
                <p className="text-sm" role="status">
                  Couldn&rsquo;t copy it here. Select the key and copy it yourself.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Make a key</CardTitle>
          <CardDescription>
            {workspaceName ? (
              <>
                A key acts as you, in <strong>{workspaceName}</strong>: the reviews it runs and
                reads are that workspace&rsquo;s. To use the API in another workspace, switch to it
                and make a key there.
              </>
            ) : (
              <>A key acts as you, and can do only what you choose for it below.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scopes.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              This installation has no API access to offer yet.
            </p>
          ) : (
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
                <Label htmlFor="api-key-name" className="flex items-center gap-1">
                  Name
                  <FieldHelp title="Naming a key">
                    <p>
                      Something that tells you where the key is used, like &ldquo;CI checks&rdquo;
                      or &ldquo;Newsletter tool&rdquo;. It is shown in the list below, so you know
                      which one to revoke.
                    </p>
                  </FieldHelp>
                </Label>
                <Input
                  id="api-key-name"
                  name="api-key-name"
                  value={name}
                  maxLength={NAME_MAX}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <fieldset id="api-key-scopes" className="space-y-2">
                <legend className="flex items-center gap-1 text-sm font-medium">
                  What it can do
                  <FieldHelp title="What a key can do">
                    <p>
                      A key can only call the parts of the API you tick here. Give it no more than
                      the job needs: a key that only downloads reports can&rsquo;t run reviews or
                      spend your workspace&rsquo;s budget.
                    </p>
                  </FieldHelp>
                </legend>
                {scopes.map((scope) => {
                  const id = `api-key-scope-${scope}`;
                  return (
                    <div key={scope} className="flex items-start gap-3">
                      <Checkbox
                        id={id}
                        checked={picked.includes(scope)}
                        onCheckedChange={(on) => toggleScope(scope, on)}
                        className="mt-1"
                      />
                      <div>
                        <Label htmlFor={id}>{scopeLabel(scope)}</Label>
                        {SCOPE_DESCRIPTIONS[scope] ? (
                          <p className="text-muted-foreground text-sm">
                            {SCOPE_DESCRIPTIONS[scope].detail}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="api-key-expiry" className="flex items-center gap-1">
                  Expires after
                  <FieldHelp title="When a key expires">
                    <p>
                      After this, the key stops working and you make a new one. A key that expires
                      limits the harm if it leaks. You can revoke any key sooner.
                    </p>
                  </FieldHelp>
                </Label>
                <Select
                  value={expiry}
                  onValueChange={(value) => {
                    const choice = EXPIRY_CHOICES.find((c) => c.value === value);
                    if (choice) setExpiry(choice.value);
                  }}
                >
                  <SelectTrigger id="api-key-expiry" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_CHOICES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-4">
                <Button type="submit" disabled={creating}>
                  {creating ? 'Making the key…' : 'Make key'}
                </Button>
              </div>
              <SaveError failure={create.failure} />
            </form>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="api-keys-heading" className="space-y-3">
        <h2
          id="api-keys-heading"
          ref={keysHeading}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          Your keys
        </h2>
        <p role="status" className="text-sm">
          {revokedName === null ? null : <>Revoked &ldquo;{revokedName}&rdquo;.</>}
        </p>
        {keys.length === 0 ? (
          <p className="text-muted-foreground text-sm">You haven&rsquo;t made any keys yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Can</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => {
                const state = keyState(key, now);
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">
                      {key.name}
                      {key.orgId === null ? (
                        <span className="text-muted-foreground block text-xs">
                          Platform key: not tied to one workspace
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{key.keyPrefix}…</code>
                    </TableCell>
                    <TableCell>{key.scopes.map(scopeLabel).join(', ')}</TableCell>
                    <TableCell>
                      {key.lastUsedAt ? <ClientDate date={key.lastUsedAt} /> : 'Never'}
                    </TableCell>
                    <TableCell>
                      {key.expiresAt ? <ClientDate date={key.expiresAt} /> : 'No expiry'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={state === 'active' ? 'secondary' : 'outline'}>
                        {STATE_LABELS[state]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {state === 'revoked' ? null : (
                        <AlertDialog
                          open={revokeId === key.id}
                          onOpenChange={revokeDialog.onOpenChange}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setRevokeId(key.id)}
                            >
                              Revoke<span className="sr-only"> {key.name}</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revoke &ldquo;{key.name}&rdquo;?</AlertDialogTitle>
                              <AlertDialogDescription>
                                It stops working straight away, and anything using it will be
                                refused. This can&rsquo;t be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <SaveError failure={revoke.failure} />
                            <AlertDialogFooter>
                              <AlertDialogCancel {...revokeDialog.cancelProps}>
                                Cancel
                              </AlertDialogCancel>
                              {/* Closes only on success, so a failure stays readable here. */}
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                {...revokeDialog.actionProps()}
                                onClick={(e) => revokeDialog.confirm(e, () => handleRevoke(key.id))}
                              >
                                {revoking ? 'Revoking…' : 'Revoke'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
