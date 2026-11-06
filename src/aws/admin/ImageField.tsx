import { useRef } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import DatasetImage from '../../components/DatasetImage';
import { IMAGE_TYPES } from './imageUpload';

interface Props {
  label: string;
  /** Raw value: a repo path, `upload:<token>` for a new file, or undefined. */
  value: string | undefined;
  /** Displayable URL for `value` (null while unknown). */
  src: string | null;
  onPick: (file: File) => void;
  onRemove: () => void;
  busy?: boolean;
}

/** Shows an image of the question being edited (click = fullscreen) and lets an admin replace, add or remove it. */
export default function ImageField({ label, value, src, onPick, onRemove, busy }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const isNew = !!value && value.startsWith('upload:');
  return (
    <div className="flex flex-wrap items-start gap-3">
      {value && src ? (
        <DatasetImage
          src={src}
          alt={label}
          className="max-h-40 max-w-full sm:max-w-[60%] rounded border border-slate-700/50 bg-slate-900 object-contain"
        />
      ) : value ? (
        <span className="text-xs text-rose-400">Anteprima non disponibile</span>
      ) : (
        <span className="text-xs text-slate-600">Nessuna immagine</span>
      )}
      <div className="flex flex-col items-start gap-1.5 text-xs">
        <input
          ref={input}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ''; // picking the same file again must fire onChange
            if (f) onPick(f);
          }}
        />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 text-slate-400 hover:text-amber-400 disabled:opacity-40">
          <ImagePlus className="w-3.5 h-3.5" /> {value ? 'Sostituisci immagine' : 'Aggiungi immagine'}
        </button>
        {value && (
          <button type="button" disabled={busy} onClick={onRemove} className="inline-flex items-center gap-1.5 text-slate-500 hover:text-rose-400 disabled:opacity-40">
            <Trash2 className="w-3.5 h-3.5" /> Rimuovi immagine
          </button>
        )}
        {isNew ? (
          <span className="text-amber-400/80">nuova: viene caricata al salvataggio</span>
        ) : (
          value && <span className="font-mono text-[11px] text-slate-600 break-all">{value}</span>
        )}
      </div>
    </div>
  );
}
