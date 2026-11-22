// One chapter of how a review works (t-63). The page lives in components/app/model/.
import { ChapterPage, chapterMetadata } from '@/components/app/model/explainer-pages';

type Props = { params: Promise<{ chapter: string }> };

export async function generateMetadata({ params }: Props) {
  const { chapter } = await params;
  return chapterMetadata(chapter);
}

export default async function Page({ params }: Props) {
  const { chapter } = await params;
  return <ChapterPage slug={chapter} />;
}
