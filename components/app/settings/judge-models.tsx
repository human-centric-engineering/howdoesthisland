'use client';

/**
 * Which model each judge and the editor runs on, for a workspace's owners and
 * admins (j4, D8). Reads what `GET /api/v1/workspaces/[id]/judges` offers and
 * saves each change with `PATCH …/judges/[key]`.
 *
 * Only model names and a one-line trade-off: what a model runs with (reply
 * size, reasoning, timeouts) comes with it and is not shown. "Default" follows
 * the platform's choice, which moves when the recommended model changes; any
 * other choice stays put until changed here.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FieldHelp } from '@/components/ui/field-help';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  judgeModelChoiceSchema,
  judgeModelEndpoint,
  type JudgeModelChoiceView,
} from '@/components/app/settings/schemas';

/** The select's value for "follow the default". Not a model id. */
const DEFAULT_VALUE = '__default__';
/**
 * The select's value for an agent the workspace owns that has no model of its
 * own (it inherits one at run time). Not a model id, and never sent: it is
 * shown so that choosing Default is a change that can be saved.
 */
const UNCHOSEN_VALUE = '__unchosen__';

function selectedValue(agent: JudgeModelChoiceView): string {
  if (agent.followsDefault) return DEFAULT_VALUE;
  return agent.current?.model ?? UNCHOSEN_VALUE;
}

function defaultLabel(agent: JudgeModelChoiceView): string {
  const option = agent.options.find((o) => o.isDefault);
  return option ? `Default (${option.label})` : 'Default';
}

export interface JudgeModelsProps {
  orgId: string;
  agents: JudgeModelChoiceView[];
}

export function JudgeModels({ orgId, agents: initial }: JudgeModelsProps) {
  const router = useRouter();
  const [agents, setAgents] = useState(initial);
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((a) => [a.key, selectedValue(a)]))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useSaveFailure({
    fallback: 'The models could not be saved. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const changed = agents.filter((a) => picks[a.key] !== selectedValue(a));

  const submit = async () => {
    setSaving(true);
    setSaved(false);
    try {
      // One at a time, so a refusal names the agent it was for and the ones
      // before it stay saved.
      for (const agent of changed) {
        const pick = picks[agent.key];
        const next = judgeModelChoiceSchema.parse(
          await apiClient.patch<unknown>(judgeModelEndpoint(orgId, agent.key), {
            body: { model: pick === DEFAULT_VALUE ? null : pick },
          })
        );
        setAgents((all) => all.map((a) => (a.key === next.key ? next : a)));
        setPicks((all) => ({ ...all, [next.key]: selectedValue(next) }));
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      save.report(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-lg">
          Judge models{' '}
          <FieldHelp title="Choosing a model">
            <p>
              Default follows our recommended model for each job, and moves with it when that
              changes. Choosing a model keeps it until you change it here.
            </p>
            <p className="mt-2">
              Each model is set up for the job it is listed for, so a judge cannot be given a model
              that would cut its answers short.
            </p>
          </FieldHelp>
        </CardTitle>
        <CardDescription>
          The AI model each judge and the editor uses in this workspace. Only models approved for
          each job, and available to this workspace, are listed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          onSubmit={save.submit(async (e) => {
            e?.preventDefault();
            await submit();
          })}
          className="space-y-4"
          noValidate
        >
          <div className="grid gap-4 md:grid-cols-2">
            {agents.map((agent) => {
              const pick = picks[agent.key] ?? DEFAULT_VALUE;
              const option = agent.options.find((o) => o.model === pick);
              const offPick =
                pick !== DEFAULT_VALUE &&
                pick !== UNCHOSEN_VALUE &&
                !option &&
                agent.current?.model === pick
                  ? agent.current
                  : null;
              const id = `judge-model-${agent.key}`;
              return (
                <div key={agent.key} className="space-y-2">
                  <Label htmlFor={id}>{agent.name}</Label>
                  <Select
                    value={pick}
                    onValueChange={(value) => {
                      setSaved(false);
                      setPicks((all) => ({ ...all, [agent.key]: value }));
                    }}
                  >
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_VALUE}>{defaultLabel(agent)}</SelectItem>
                      {agent.options.map((o) => (
                        <SelectItem key={o.model} value={o.model}>
                          {o.label}
                        </SelectItem>
                      ))}
                      {pick === UNCHOSEN_VALUE ? (
                        <SelectItem value={UNCHOSEN_VALUE} disabled>
                          No model chosen
                        </SelectItem>
                      ) : null}
                      {offPick ? (
                        <SelectItem value={offPick.model} disabled>
                          {offPick.label} (no longer offered)
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-sm">
                    {pick === DEFAULT_VALUE
                      ? 'Our recommended model for this job.'
                      : pick === UNCHOSEN_VALUE
                        ? 'Choose a model, or Default to follow our recommendation.'
                        : (option?.tradeoff ?? 'Not approved for this job: choose another.')}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-4">
            <Button type="submit" disabled={saving || changed.length === 0}>
              {saving ? 'Saving…' : 'Save models'}
            </Button>
            {saved && (
              <p className="flex items-center gap-2 text-sm" role="status">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                Saved.
              </p>
            )}
          </div>

          <SaveError failure={save.failure} />
        </form>
      </CardContent>
    </Card>
  );
}
