import type { LibraryFolderSummary, LibraryTrackSummary } from "../../shared/api/types";
import type { LibrarySortState } from "./libraryViewTypes";
import type {
  LibraryWorkerFolderGroup,
  LibraryWorkerRange,
  LibraryWorkerRequest,
  LibraryWorkerResponse,
  LibraryWorkerRow,
  LibraryWorkerViewInput
} from "./libraryWorkerProtocol";

export interface LibraryWorkerViewResult {
  range: LibraryWorkerRange;
  rows: LibraryWorkerRow[];
  total: number;
  totalSizeBytes: number;
  folders: LibraryWorkerFolderGroup[];
}

export interface LibraryWorkerClientHandlers {
  onReady: (total: number) => void;
  onViewResult: (result: LibraryWorkerViewResult) => void;
  onError: (error: Error) => void;
}

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export class LibraryWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private latestInitRequestId = 0;
  private latestViewRequestId = 0;
  private ready = false;
  private readonly pendingMediaIdRequests = new Map<number, PendingRequest<string[]>>();
  private readonly pendingRowRequests = new Map<number, PendingRequest<LibraryWorkerRow[]>>();

  constructor(private readonly handlers: LibraryWorkerClientHandlers) {}

  get isReady(): boolean {
    return this.ready;
  }

  init(tracks: LibraryTrackSummary[], folders: LibraryFolderSummary[]): void {
    this.ready = false;
    this.rejectPendingRequests("Library index refreshed");
    const requestId = this.nextRequestId();
    this.latestInitRequestId = requestId;
    this.latestViewRequestId = 0;
    this.postMessage({
      type: "INIT",
      requestId,
      tracks,
      folders
    });
  }

  requestView(input: LibraryWorkerViewInput, range: LibraryWorkerRange): boolean {
    if (!this.ready) return false;
    const requestId = this.nextRequestId();
    this.latestViewRequestId = requestId;
    this.postMessage({
      type: "VIEW",
      requestId,
      queries: input.queries,
      folderPath: input.folderPath,
      sort: input.sort,
      range
    });
    return true;
  }

  requestMediaIds(input: LibraryWorkerViewInput): Promise<string[]> {
    this.assertReady();
    const requestId = this.nextRequestId();
    const message: LibraryWorkerRequest = {
      type: "MEDIA_IDS",
      requestId,
      queries: input.queries,
      folderPath: input.folderPath,
      sort: input.sort
    };
    return new Promise<string[]>((resolve, reject) => {
      this.pendingMediaIdRequests.set(requestId, { resolve, reject });
      this.postMessage(message);
    });
  }

  requestRows(input: LibraryWorkerViewInput): Promise<LibraryWorkerRow[]> {
    this.assertReady();
    const requestId = this.nextRequestId();
    const message: LibraryWorkerRequest = {
      type: "ROWS",
      requestId,
      queries: input.queries,
      folderPath: input.folderPath,
      sort: input.sort
    };
    return new Promise<LibraryWorkerRow[]>((resolve, reject) => {
      this.pendingRowRequests.set(requestId, { resolve, reject });
      this.postMessage(message);
    });
  }

  dispose(): void {
    this.rejectPendingRequests("Library worker was disposed");
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new Error("Library worker is not ready");
    }
  }

  private postMessage(message: LibraryWorkerRequest): void {
    this.ensureWorker().postMessage(message);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./libraryWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<LibraryWorkerResponse>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = () => {
      this.ready = false;
      this.rejectPendingRequests("Library worker failed");
      this.handlers.onError(new Error("Library worker failed"));
    };
    return this.worker;
  }

  private handleMessage(message: LibraryWorkerResponse): void {
    switch (message.type) {
      case "READY":
        if (message.requestId === this.latestInitRequestId) {
          this.ready = true;
          this.handlers.onReady(message.total);
        }
        return;
      case "MEDIA_IDS_RESULT": {
        const pending = this.pendingMediaIdRequests.get(message.requestId);
        if (pending) {
          this.pendingMediaIdRequests.delete(message.requestId);
          pending.resolve(message.mediaIds);
        }
        return;
      }
      case "ROWS_RESULT": {
        const pending = this.pendingRowRequests.get(message.requestId);
        if (pending) {
          this.pendingRowRequests.delete(message.requestId);
          pending.resolve(message.rows);
        }
        return;
      }
      case "VIEW_RESULT":
        if (message.requestId === this.latestViewRequestId) {
          this.handlers.onViewResult({
            range: message.range,
            rows: message.rows,
            total: message.total,
            totalSizeBytes: message.totalSizeBytes,
            folders: message.folders
          });
        }
        return;
      default: {
        const _exhaustive: never = message;
        throw new Error(`Unhandled library worker response: ${_exhaustive}`);
      }
    }
  }

  private rejectPendingRequests(message: string): void {
    this.pendingMediaIdRequests.forEach((pending) => {
      pending.reject(new Error(message));
    });
    this.pendingMediaIdRequests.clear();
    this.pendingRowRequests.forEach((pending) => {
      pending.reject(new Error(message));
    });
    this.pendingRowRequests.clear();
  }
}

export const createLibraryWorkerViewInput = (
  queries: string[],
  folderPath: string | null,
  sort: LibrarySortState
): LibraryWorkerViewInput => ({
  queries,
  folderPath,
  sort
});
