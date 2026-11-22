// The model, latest version (t-63). The page lives in components/app/model/.
import { ModelIndexPage, modelIndexMetadata } from '@/components/app/model/model-pages';

export const generateMetadata = () => modelIndexMetadata();

export default function Page() {
  return <ModelIndexPage />;
}
