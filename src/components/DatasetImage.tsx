import { useEffect, useState } from 'react';
import { isPrivateImage, fetchPrivateImage } from '../utils/datasets';

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string };

/** <img> that also handles images stored in private repos (fetched with the source token). */
export default function DatasetImage({ src, alt, ...rest }: Props) {
  const priv = isPrivateImage(src);
  const [resolved, setResolved] = useState<string | null>(priv ? null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!priv) { setResolved(src); setFailed(false); return; }
    let cancelled = false;
    setResolved(null); setFailed(false);
    fetchPrivateImage(src).then((u) => { if (!cancelled) setResolved(u); }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [src, priv]);

  if (failed) return <span className="text-xs text-rose-400">Image could not be loaded</span>;
  if (!resolved) return <span className="inline-block h-16 w-24 animate-pulse rounded bg-slate-800" aria-label="Loading image" />;
  return <img src={resolved} alt={alt} loading="lazy" {...rest} />;
}
