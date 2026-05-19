import { useState, useEffect } from "react";
import { MoreHorizontal, Trash2, FileTextIcon, Loader2 } from "lucide-react";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";

export type NotePageUIProps = {
  noteId: string;
  noteTitle: string;
  noteEmoji: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  lastEditDate: Date;
  onTitleChange: (value: string) => void;
  onDelete: () => void;
  onEmojiChange: (emoji: string | null) => void;
  onBack?: () => void;
  isDeleting?: boolean;
  children?: React.ReactNode;
};

function formatRelativeTime(date: Date, locale: string): string {
  const now = new Date();
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (diffSeconds < 60) {
    return rtf.format(0, "second");
  }

  const diffMins = Math.floor(diffSeconds / 60);
  if (diffMins < 60) {
    return rtf.format(-diffMins, "minute");
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return rtf.format(-diffHours, "hour");
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return rtf.format(-1, "day");
  }

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  }).format(date);
}

export default function Note({
  noteTitle,
  noteEmoji,
  isLoading,
  isSyncing,
  lastEditDate,
  onTitleChange,
  onDelete,
  onEmojiChange,
  isDeleting = false,
  children,
}: NotePageUIProps) {
  const { t, i18n } = useTranslation();
  // Local UI state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [, setTick] = useState(0);
  const [localEditTime, setLocalEditTime] = useState<Date | null>(null);

  // Update relative time every 1 minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Update local edit time when syncing starts (user just edited)
  useEffect(() => {
    if (isSyncing) {
      setLocalEditTime(new Date());
    }
  }, [isSyncing]);

  const handleDeleteClick = () => {
    setShowDeleteDialog(false);
    onDelete();
  };

  const handleEmojiSelect = (emojiData: { emoji: string }) => {
    onEmojiChange(emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const handleEmojiRemove = () => {
    onEmojiChange(null);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="max-w-4xl mx-auto w-full">
        {/* Note Content */}
        <div className="mt-0 space-y-2">
          {/* Note Title with Emoji Picker */}
          <div className="flex items-center">
            {/* Emoji Picker */}
            <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-12 w-12 p-0 hover:bg-muted/50"
                >
                  {noteEmoji ? (
                    <span className="text-2xl">{noteEmoji}</span>
                  ) : (
                    <FileTextIcon className="!h-6 !w-6 text-muted-foreground" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div>
                  {noteEmoji && (
                    <div className="flex justify-end p-2 border-b">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleEmojiRemove}
                        className="text-xs"
                      >
                        {t("settings.notes.note.removeEmoji")}
                      </Button>
                    </div>
                  )}
                  <EmojiPicker
                    onEmojiClick={handleEmojiSelect}
                    autoFocusSearch={false}
                    theme={Theme.DARK}
                    lazyLoadEmojis={false}
                    height={400}
                    width={400}
                  />
                </div>
              </PopoverContent>
            </Popover>

            {/* Note Title Input */}
            <Input
              value={noteTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              className="!text-4xl font-semibold !border-0 !shadow-none px-4 py-2 focus-visible:!ring-0 focus-visible:!border-0 placeholder:text-muted-foreground flex-1"
              style={{ backgroundColor: "transparent" }}
              placeholder={t("settings.notes.note.titlePlaceholder")}
            />
          </div>

          {/* Top Bar */}
          <div className="flex items-center justify-start pl-4 pb-0.5 bg-card">
            {/* Right side - Actions */}
            <div className="flex items-center ">
              {/* Last edited date */}
              <span className="text-sm text-muted-foreground">
                {t("settings.notes.note.edited", {
                  date: formatRelativeTime(
                    localEditTime && localEditTime > lastEditDate
                      ? localEditTime
                      : lastEditDate,
                    i18n.language,
                  ),
                })}
              </span>

              {/* More actions dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <AlertDialog
                    open={showDeleteDialog}
                    onOpenChange={setShowDeleteDialog}
                  >
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem
                        className="gap-2"
                        onSelect={(e) => e.preventDefault()}
                        variant="destructive"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                        {t("settings.notes.note.actions.delete")}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Note Body - Lexical Editor */}
          {children}
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings.notes.note.deleteDialog.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings.notes.note.deleteDialog.description", {
                  title: noteTitle,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("settings.notes.note.deleteDialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteClick}
                className="bg-destructive text-foreground hover:bg-destructive/90"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t("settings.notes.note.deleteDialog.deleting")}
                  </>
                ) : (
                  t("settings.notes.note.deleteDialog.confirm")
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
