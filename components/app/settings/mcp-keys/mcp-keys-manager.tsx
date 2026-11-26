'use client';

/**
 * A workspace's MCP keys, for its owners and admins (t-95): make one, see
 * them, revoke one. Over `GET`/`POST /api/v1/workspaces/[id]/mcp-keys` and
 * `POST …/[keyId]/revoke`.
 *
 * A key lets an AI assistant use this workspace's tools, acting as the person
 * who made it, and spends the workspace's credits. There are no scopes to
 * choose: the API gives every key only what the tools need. A new key's value
 * is shown once, in a panel that stays until it is dismissed.
 *
 * Shaped like the personal API-keys page (`api-keys-manager.tsx`), which a
 * person meets first, so the two read alike.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Copy } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';
import {
  EXPIRY_CHOICES,
  expiresAtFor,
  type ExpiryChoice,
} from '@/components/app/settings/api-keys/schemas';
import {
  mcpKeysEndpoint,
  mcpKeyState,
  mintedMcpKeySchema,
  mintedMcpRawKeySchema,
  revokeMcpKeyEndpoint,
  type McpKeyRow,
} from '@/components/app/settings/mcp-keys/schemas';

export interface McpKeysManagerProps {
  orgId: string;
  initialKeys: McpKeyRow[];
  /** When the server rendered the page (ISO), so both draw the same badges. */
  renderedAt: string;
}

const NAME_MAX = 100;

const STATE_LABELS = { active: 'Active', expired: 'Expired', revoked: 'Revoked' } as const;

export function McpKeysManager({ orgId, initialKeys, renderedAt }: McpKeysManagerProps) {
  const [keys, setKeys] = useState(initialKeys);

  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<ExpiryChoice>('90');
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ name: string; plaintext: string } | null>(null);
  const { copied, copy } = useCopyToClipboard();
  const [copyFailed, setCopyFailed] = useState(false);
  const create = useSaveFailure({
    fallback: 'The key could not be made. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState<{ id: string; name: string } | null>(null);
  const [now, setNow] = useState(() => new Date(renderedAt));
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

  const submit = async () => {
    if (
      create.block(name.trim() ? [] : [{ field: 'mcp-key-name', message: 'Give the key a name.' }])
    )
      return;

    setRevoked(null);
    setCreating(true);
    let sent: unknown;
    try {
      const expiresAt = expiresAtFor(expiry, new Date());
      sent = await apiClient.post<unknown>(mcpKeysEndpoint(orgId), {
        body: { name: name.trim(), ...(expiresAt ? { expiresAt } : {}) },
      });
    } catch (err) {
      create.report(err);
      return;
    } finally {
      setCreating(false);
    }

    // The key exists from here on, so nothing below may say "try again":
    // that would make a second key whose value nobody holds.
    setName('');
    setCopyFailed(false);
    const minted = mintedMcpKeySchema.safeParse(sent);
    if (minted.success) {
      const { plaintext, ...row } = minted.data.key;
      setKeys((all) => [row, ...all]);
      setShown({ name: row.name, plaintext });
      return;
    }
    const raw = mintedMcpRawKeySchema.safeParse(sent);
    setShown(raw.success ? raw.data.key : null);
    create.show(
      raw.success
        ? 'The key was made, but this page could not add it to the list. Copy its value above, then reload to see it listed.'
        : 'The key was made, but this page could not read it back. Reload to see it listed, and revoke it, since its value cannot be shown again.'
    );
  };

  const handleRevoke = async (keyId: string, keyName: string) => {
    setRevoking(true);
    try {
      await apiClient.post(revokeMcpKeyEndpoint(orgId, keyId));
      setKeys((all) => all.map((k) => (k.id === keyId ? { ...k, isActive: false } : k)));
      setRevokeId(null);
      setRevoked({ id: keyId, name: keyName });
    } catch (err) {
      revoke.report(err);
    } finally {
      setRevoking(false);
    }
  };

  // A revoked row loses its Revoke button, so focus goes to the list's
  // heading, where the status line says what happened.
  useEffect(() => {
    if (revoked === null) return;
    const timer = setTimeout(() => keysHeading.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [revoked]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  return (
    <section aria-labelledby="mcp-keys-section-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="mcp-keys-section-heading" className="text-lg font-semibold">
          AI assistant keys (MCP)
        </h2>
        <p className="text-muted-foreground text-sm">
          A key lets an AI assistant, such as Claude, check, compare and rewrite drafts in this
          workspace. It acts as the person who made it, and what it runs is charged to this
          workspace&rsquo;s credits.
        </p>
      </div>

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
              <code className="text-sm break-all" data-testid="new-mcp-key">
                {shown.plaintext}
              </code>
            </div>
            <p className="text-muted-foreground text-sm">
              Give your assistant this server&rsquo;s <code>/api/v1/mcp</code> address, with the key
              as a bearer token.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copy(shown.plaintext).then((ok) => setCopyFailed(!ok))}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy key
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setShown(null);
                  create.clear();
                }}
              >
                I&rsquo;ve saved it
              </Button>
              <p className="flex items-center gap-2 text-sm" role="status">
                {copied ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    Copied.
                  </>
                ) : copyFailed ? (
                  <>Couldn&rsquo;t copy it here. Select the key and copy it yourself.</>
                ) : null}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Make a key</CardTitle>
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
              <Label htmlFor="mcp-key-name" className="flex items-center gap-1">
                Name
                <FieldHelp title="Naming a key">
                  <p>
                    Something that tells you where the key is used, like &ldquo;Sam&rsquo;s
                    Claude&rdquo; or &ldquo;Team laptop&rdquo;. It is shown in the list below, so
                    you know which one to revoke.
                  </p>
                </FieldHelp>
              </Label>
              <Input
                id="mcp-key-name"
                name="mcp-key-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-key-expiry" className="flex items-center gap-1">
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
                <SelectTrigger id="mcp-key-expiry" className="w-48">
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

            <Button type="submit" disabled={creating}>
              {creating ? 'Making the key…' : 'Make key'}
            </Button>
            <SaveError failure={create.failure} />
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3
          id="mcp-keys-heading"
          ref={keysHeading}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          This workspace&rsquo;s keys
        </h3>
        <p role="status" className="text-sm">
          {revoked === null ? null : <>Revoked &ldquo;{revoked.name}&rdquo;.</>}
        </p>
        {keys.length === 0 ? (
          <p className="text-muted-foreground text-sm">No one has made a key here yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Made by</TableHead>
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
                const state = mcpKeyState(key, now);
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="text-xs">{key.keyPrefix}…</code>
                    </TableCell>
                    <TableCell>{key.createdByName ?? 'A deleted account'}</TableCell>
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
                                It stops working straight away, and any assistant using it will be
                                refused. This can&rsquo;t be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <SaveError failure={revoke.failure} />
                            <AlertDialogFooter>
                              <AlertDialogCancel {...revokeDialog.cancelProps}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                {...revokeDialog.actionProps()}
                                onClick={(e) =>
                                  revokeDialog.confirm(e, () => handleRevoke(key.id, key.name))
                                }
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
      </div>
    </section>
  );
}
