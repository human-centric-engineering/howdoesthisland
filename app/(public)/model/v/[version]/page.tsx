// The model at one published version (t-63). The page lives in components/app/model/.
import { ModelIndexPage, modelIndexMetadata } from '@/components/app/model/model-pages';

type Props = { params: Promise<{ version: string }> };

export async function generateMetadata({ params }: Props) {
  const { version } = await params;
  return modelIndexMetadata(version);
}

export default async function Page({ params }: Props) {
  const { version } = await params;
  return <ModelIndexPage version={version} />;
}
