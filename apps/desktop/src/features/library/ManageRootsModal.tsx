import { For, Show, createSignal } from "solid-js";
import type { LibraryRoot } from "../../shared/api/types";
import { useTranslation } from "../../shared/i18n";
import { Modal } from "../../components/Modal";
import { IconDelete, IconFolder, IconFolderPlus } from "../../components/icons";

export interface ManageRootsModalProps {
  open: boolean;
  onClose: () => void;
  roots: LibraryRoot[];
  isScanning: boolean;
  onAddRoot: (path: string, displayName: string) => Promise<void>;
  onDeleteRoot: (root: LibraryRoot) => Promise<void>;
}

export function ManageRootsModal(props: ManageRootsModalProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = createSignal(false);

  const handleAdd = async () => {
    const path = window.prompt(t("library.add.pathPlaceholder"))?.trim() ?? "";
    if (!path) return;
    setSubmitting(true);
    try {
      await props.onAddRoot(path, "");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (root: LibraryRoot) => {
    setSubmitting(true);
    try {
      await props.onDeleteRoot(root);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      title={t("library.modal.manageRoots.title")}
      closeAriaLabel={t("library.modal.manageRoots.close")}
      onClose={props.onClose}
      size="directory"
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
      <div class="local-directory-modal">
        <span class="local-list-tip">
          {t("library.modal.manageRoots.tip")}
        </span>
        <div class="local-directory-scroll">
          <div class="local-directory-list">
            <Show
              when={props.roots.length > 0}
              fallback={
                <div class="local-directory-empty">
                  {t("library.roots.empty")}
                </div>
              }
            >
            <For each={props.roots}>
              {(root) => (
                <div class="local-directory-item">
                  <span class="local-directory-prefix" aria-hidden="true">
                    <IconFolder />
                  </span>
                  <span class="local-directory-path" title={root.source_path}>
                    {root.source_path}
                  </span>
                  <button
                    type="button"
                    class="local-directory-delete"
                    onClick={() => void handleDelete(root)}
                    disabled={props.isScanning || submitting()}
                    aria-label={t("library.roots.delete")}
                    title={t("library.roots.delete")}
                  >
                    <IconDelete />
                  </button>
                </div>
              )}
            </For>
            </Show>
          </div>
        </div>
        <div class="local-directory-footer">
          <button
            class="ghost-button local-directory-add"
            type="button"
            onClick={() => void handleAdd()}
            disabled={props.isScanning || submitting()}
          >
            <IconFolderPlus />
            <span>{t("library.add.folder")}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
