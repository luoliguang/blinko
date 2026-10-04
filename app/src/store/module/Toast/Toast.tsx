import { Store } from "@/store/standard/base";
import toast, { Toaster } from "react-hot-toast";
import { Progress } from "@heroui/react";
import i18n from "@/lib/i18n";

interface UploadProgressProps {
  progress: number;
  fileName: string;
  speed: string;
  loaded: string;
  total: string;
}

const UploadProgressToast = ({ progress, fileName, speed, loaded, total }: UploadProgressProps) => (
  <div className="w-80 bg-background rounded-lg p-4 shadow-lg">
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium truncate" title={fileName}>
        {fileName}
      </div>
      <Progress 
        value={progress} 
        className="max-w-md"
        size="sm"
        radius="sm"
        classNames={{
          base: "max-w-md",
          track: "drop-shadow-md border border-default",
          indicator: "bg-gradient-to-r from-pink-500 to-yellow-500",
          label: "tracking-wider font-medium text-default-600",
          value: "text-foreground/60"
        }}
        showValueLabel={true}
      />
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>{speed}/s</span>
        <span>
          {loaded} / {total}
        </span>
      </div>
    </div>
  </div>
);

export class ToastPlugin implements Store {
  sid = "ToastPlugin";
  private sizeThreshold = 5;

  provider = () => (
    <Toaster
      toastOptions={{
        className: '!bg-[#fff] !rounded-2xl !text-[#000] dark:!bg-[#131218] dark:!text-[#fff] !shadow-md',
      }}
    />
  );

  splitTextIntoLines(text: string, lineLength: number): string {
    const regex = new RegExp(`.{1,${lineLength}}`, 'g');
    return text.match(regex)?.join('\n') || '';
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  setSizeThreshold(megabytes: number) {
    this.sizeThreshold = megabytes;
    return this;
  }

  uploadProgress(file: File) {
    if (file.size < this.sizeThreshold * 1024 * 1024) {
      return {
        onUploadProgress: () => {}
      };
    }

    let startTime = Date.now();
    let lastLoaded = 0;
    let toastId: string;

    const updateProgress = (loaded: number, total: number) => {
      const currentTime = Date.now();
      const timeElapsed = (currentTime - startTime) / 1000;
      const loadedDiff = loaded - lastLoaded;
      const speed = loadedDiff / timeElapsed;
      
      lastLoaded = loaded;
      startTime = currentTime;

      const progress = Math.round((loaded * 100) / total);

      if (!toastId) {
        toastId = toast.custom((t) => (
          <UploadProgressToast
            progress={progress}
            fileName={file.name}
            speed={this.formatBytes(speed)}
            loaded={this.formatBytes(loaded)}
            total={this.formatBytes(total)}
          />
        ), { duration: Infinity });
      } else {
        toast.custom((t) => (
          <UploadProgressToast
            progress={progress}
            fileName={file.name}
            speed={this.formatBytes(speed)}
            loaded={this.formatBytes(loaded)}
            total={this.formatBytes(total)}
          />
        ), { id: toastId });
      }

      if (progress === 100) {
        setTimeout(() => {
          toast.dismiss(toastId);
          this.success(i18n.t('upload-completed'));
        }, 1000);
      }
    };

    return {
      onUploadProgress: (progressEvent: any) => {
        updateProgress(progressEvent.loaded, progressEvent.total);
      }
    };
  }

  success(str: string) {
    toast.success(str, { icon: '👏' })
  };
  error(str: string) {
    toast.error(this.splitTextIntoLines(str, 60))
  };
  // A persistent toast telling the user a new app version is ready, with a button
  // to apply it (reload). Used when they have an unsaved draft so we don't reload
  // from under them. Fixed id so repeated checks don't stack duplicate toasts.
  updateAvailable(onConfirm: () => void) {
    toast((t) => (
      <span className="flex items-center gap-3">
        <span>{i18n.t('new-version-available')}</span>
        <button
          className="text-primary font-semibold shrink-0"
          onClick={() => {
            toast.dismiss(t.id);
            onConfirm();
          }}
        >
          {i18n.t('refresh')}
        </button>
      </span>
    ), { duration: Infinity, id: 'pwa-update' });
  };
  // A toast with an inline "Undo" button, for reversible actions like moving to trash.
  undoable(str: string, onUndo: () => void | Promise<void>, duration = 5000) {
    toast((t) => (
      <span className="flex items-center gap-3">
        <span>{str}</span>
        <button
          className="text-primary font-semibold shrink-0"
          onClick={() => {
            toast.dismiss(t.id);
            onUndo();
          }}
        >
          {i18n.t('undo')}
        </button>
      </span>
    ), { duration });
  };
  loading = toast.loading;
  custom = toast.custom;
  dismiss = toast.dismiss;
  remove = toast.remove;
  promise = toast.promise;
}
