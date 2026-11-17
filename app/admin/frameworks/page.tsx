import type { Metadata } from 'next';

import { CalibrationPanel } from '@/components/app/admin/frameworks/calibration-panel';
import { FieldHelp } from '@/components/ui/field-help';
import { requireServerData } from '@/lib/api/server-load';
import { ADMIN_FRAMEWORKS_PATH, frameworkCalibrationSchema } from '@/lib/app/calibration/wire';

export const metadata: Metadata = {
  title: 'Frameworks',
  description: 'Framework versions and how their judges agree with the calibration set.',
};

/**
 * Admin — Frameworks (t-38).
 *
 * Thin server shell over `GET /api/v1/admin/frameworks`. The admin tree is
 * platform-admin only (the layout refuses anyone else), and so is the route.
 * A failed load throws to the admin error boundary rather than rendering an
 * empty list.
 */
export default async function FrameworksPage() {
  const { data } = await requireServerData<unknown>(ADMIN_FRAMEWORKS_PATH);
  // Checked at the boundary: a body that is not the list throws to the error
  // boundary here rather than at render.
  const [framework] = frameworkCalibrationSchema.array().parse(data);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          Frameworks{' '}
          <FieldHelp title="What is calibration?">
            <p>
              Each framework version has a calibration set: texts with the results an honest reading
              should give. A run scores every case and records how often the result agreed, by kind
              of check.
            </p>
            <p className="mt-2">
              Each run is compared with the run before it of the same mode, against any version, so
              you can see what a change of model, prompt or version moved. Publishing a draft needs
              a complete AI run of it, and is done from the command line.
            </p>
          </FieldHelp>
        </h1>
        <p className="text-muted-foreground text-sm">
          Framework versions, their calibration and the runs behind it. Pick a run to see its cases.
        </p>
      </header>

      {framework ? (
        <CalibrationPanel initial={framework} />
      ) : (
        <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">
          No frameworks could be loaded.
        </p>
      )}
    </div>
  );
}
