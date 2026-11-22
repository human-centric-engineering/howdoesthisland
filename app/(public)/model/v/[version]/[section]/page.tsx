// One section of the model at one published version (t-63). The page lives in components/app/model/.
import { ModelSectionPage, modelSectionMetadata } from '@/components/app/model/model-pages';

type Props = { params: Promise<{ version: string; section: string }> };

export async function generateMetadata({ params }: Props) {
  const { version, section } = await params;
  return modelSectionMetadata(section, version);
}

export default async function Page({ params }: Props) {
  const { version, section } = await params;
  return <ModelSectionPage segment={section} version={version} />;
}
