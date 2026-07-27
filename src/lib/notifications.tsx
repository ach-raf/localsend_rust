import type { ReactNode } from "react";
import { toast, type ExternalToast } from "sonner";

type NotificationId = string | number;

interface NotificationOptions {
  id?: NotificationId;
  title?: ReactNode;
  message?: ReactNode;
  color?: string;
  loading?: boolean;
  autoClose?: number | false;
  action?:
    | ReactNode
    | {
        label: ReactNode;
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
      };
  icon?: ReactNode;
}

interface NotificationUpdateOptions extends NotificationOptions {
  id: NotificationId;
}

function duration(autoClose: NotificationOptions["autoClose"]) {
  if (autoClose === false) return Infinity;
  return autoClose;
}

function showNotification(options: NotificationOptions): NotificationId {
  const { title, message, color, loading, autoClose, ...rest } = options;
  const toastOptions: ExternalToast = {
    ...rest,
    description: message,
    duration: duration(autoClose),
  };
  const heading = title ?? message ?? "";

  if (loading) return toast.loading(heading, toastOptions);
  if (color === "red") return toast.error(heading, toastOptions);
  if (color === "yellow" || color === "orange") {
    return toast.warning(heading, toastOptions);
  }
  if (color === "phosphor") return toast.success(heading, toastOptions);
  return toast(heading, toastOptions);
}

export const notifications = {
  show: showNotification,
  update: (options: NotificationUpdateOptions) => showNotification(options),
  hide: (id: NotificationId) => toast.dismiss(id),
};
