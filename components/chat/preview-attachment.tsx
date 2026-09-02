import { FileTextIcon, FilmIcon, MicIcon } from "lucide-react";
import Image from "next/image";
import type { Attachment } from "@/lib/types";
import { Spinner } from "../ui/spinner";
import { CrossSmallIcon } from "./icons";

// ВИД ВЛОЖЕНИЯ — В ПОЛЕ ВВОДА И В ЛЕНТЕ (правка владельца 2026-09-02).
//
// 🔒 ЧЕТЫРЕ РОДА ВИДНЫ ПО-РАЗНОМУ, А НЕ ОДНИМ СЛОВОМ «File». Шаблон рисовал
// картинку и «File» на всё остальное: голосовая запись, ролик и договор
// выглядели одинаково, и человек не мог отличить их в собственной переписке.
//
// 🔒 ЗВУК И ВИДЕО ИГРАЮТСЯ ПРЯМО ЗДЕСЬ. Требование владельца — записи должны
// ОСТАВАТЬСЯ в ленте; ссылка на файл, который негде открыть, оставляет их
// формально, а не по существу.

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove,
}: {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
}) => {
  const { name, url, contentType } = attachment;
  const kind = contentType?.split("/")[0] ?? "";

  return (
    <div
      className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted"
      data-attachment-kind={kind || "file"}
      data-testid="input-attachment-preview"
    >
      {kind === "image" ? (
        <Image
          alt={name ?? "attachment"}
          className="size-full object-cover"
          height={96}
          src={url}
          width={96}
        />
      ) : kind === "audio" ? (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-1">
          <MicIcon className="size-5 text-muted-foreground" />
          {/* Проигрыватель браузера: маленький, но настоящий — запись можно
              переслушать там же, где она лежит. */}
          <audio className="w-full" controls preload="none" src={url}>
            <track kind="captions" />
          </audio>
        </div>
      ) : kind === "video" ? (
        <div className="relative size-full">
          <video className="size-full object-cover" muted preload="metadata" src={url}>
            <track kind="captions" />
          </video>
          <FilmIcon className="absolute right-1 bottom-1 size-4 text-white drop-shadow" />
        </div>
      ) : (
        <a
          className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center"
          href={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <FileTextIcon className="size-5 text-muted-foreground" />
          {/* Имя файла обрезается двумя строками: документ узнают по имени, и
              безымянный значок не отличает договор от выписки. */}
          <span className="line-clamp-2 break-all text-[10px] text-muted-foreground">
            {name ?? "file"}
          </span>
        </a>
      )}

      {isUploading ? (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-sm"
          data-testid="input-attachment-loader"
        >
          <Spinner className="size-5" />
        </div>
      ) : null}

      {onRemove && !isUploading && (
        <button
          className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100"
          onClick={onRemove}
          type="button"
        >
          <CrossSmallIcon size={10} />
        </button>
      )}
    </div>
  );
};
