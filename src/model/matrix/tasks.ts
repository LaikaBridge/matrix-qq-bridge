import type { MatrixMessage } from "./message";

interface TaskFetchMXCImage {
    type: "fetchMXCimage";
    mxcURL: string;
}

interface TaskFetchMXCImageReponse {
    type: "fetchMXCimageReponse";
    file: string;
}

interface MatrixMessageSent {
    type: "messageSent";
    uuid: string;
    messageId: string;
}

interface TaskReplaceMessage {
    type: "replaceMessage";
    messageId: string;
    data: MatrixMessage;
}

export type Task = TaskFetchMXCImage | TaskReplaceMessage;
export type TaskResponse = TaskFetchMXCImageReponse | MatrixMessageSent;
