/**
 * The link to `/settings/api-keys` at the foot of `/settings` (t-43), through
 * the account-sections seam (`lib/app/account-sections.ts`). The seam renders
 * a section, not a page, so the key manager has a page of its own and this
 * points at it.
 */
import Link from 'next/link';
import { KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AccountSectionProps } from '@/lib/account-sections/registry';
import { API_KEYS_PAGE_HREF } from '@/components/app/settings/api-keys/schemas';

export function ApiKeysSection(_props: AccountSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
          API keys
        </CardTitle>
        <CardDescription>
          Keys let your own tools run reviews and fetch reports through the API.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={API_KEYS_PAGE_HREF}>Manage API keys</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
