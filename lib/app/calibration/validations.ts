/**
 * What the admin calibration routes accept (t-38).
 */
import { z } from 'zod';
import { slugParam, versionParam } from '@/lib/app/frameworks/api/validations';

export const calibrationRunParamsSchema = z.object({ slug: slugParam, version: versionParam });

export const startCalibrationRunSchema = z.object({ mode: z.enum(['quick', 'ai']) });
