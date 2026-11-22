// One section of the model, latest version (t-63). The page lives in components/app/model/.
import { ModelSectionPage, modelSectionMetadata } from '@/components/app/model/model-pages';

type Props = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: Props) {
  const { section } = await params;
  return modelSectionMetadata(section);
}

export default async function Page({ params }: Props) {
  const { section } = await params;
  return <ModelSectionPage segment={section} />;
}
