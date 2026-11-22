// How a review works: the model in human terms (t-63). The page lives in components/app/model/.
import { ModelHubPage, hubMetadata } from '@/components/app/model/explainer-pages';

export const metadata = hubMetadata;

export default function Page() {
  return <ModelHubPage />;
}
