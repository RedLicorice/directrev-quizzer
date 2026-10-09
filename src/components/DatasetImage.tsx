import { useEffect, useState } from 'react';
import { isPrivateImage, fetchPrivateImage } from '../utils/datasets';
import { refreshSession } from '../aws/auth/session';

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string };

/** <img> that also handles images stored in private repos (fetched with the source token). */
export default function DatasetImage({ src, alt, ...rest }: Props) {
  const priv = isPrivateImage(src);
  const [resolved, setResolved] = useState<string | null>(priv ? null : src);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    setRetried(false);
    if (!priv) { setResolved(src); setFailed(false); return; }
    let cancelled = false;
    setResolved(null); setFailed(false);
    fetchPrivateImage(src).then((u) => { if (!cancelled) setResolved(u); }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [src, priv]);

  // AWS build: hosted images are plain same-origin URLs authenticated by the session cookie.
  // If the cookie expired meanwhile, refresh it once and reload the image.
  function onError() {
    if (import.meta.env.VITE_DEPLOY === 'aws' && !retried && src.startsWith(`${import.meta.env.BASE_URL}data/`)) {
      setRetried(true);
      refreshSession().then(
        (s) => { if (s) setResolved(`${src}${src.includes('?') ? '&' : '?'}r=${Date.now()}`); else setFailed(true); },
        () => setFailed(true),
      );
      return;
    }
    if (import.meta.env.VITE_DEPLOY === 'aws') setFailed(true);
  }

  if (failed) return <span className="text-xs text-rose-400">Image could not be loaded</span>;
  if (!resolved) return <span className="inline-block h-16 w-24 animate-pulse rounded bg-slate-800" aria-label="Loading image" />;
  return <img src={resolved} alt={alt} loading="lazy" onError={onError} {...rest} />;
}
