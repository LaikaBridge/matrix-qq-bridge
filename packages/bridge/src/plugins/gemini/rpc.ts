/// A "stored" message
export type R =  {
	groupId: string;
	userName: string;
	content: string;
	messageId: string;
	timeStamp: number;
}
export type Reply = {
    type: "text", text: string
} | {
    type: "query", payload: R[]
}
export type PhotoId = {url: string}
export type Photo = {
    file_id: PhotoId
}
export interface CtxCommandData{
    update_type: "message" | "photo" | "command"
    update: {
        message:{
            photo: Photo[];
            sender_chat:{
                title: string
            }
            from: {
                id: string;
                username: string;
                first_name: string;
                is_bot: boolean
            }
            chat: {
                type: "group"
                id: string;
                title: string;
            }
            text: string;
            message_id: string;
        }
    }
    bot: {
        api: "APIKEY"
    }
}
export const AVAILABLE_COMMANDS = ["status", "query", "ask", "summary"] as const;
export type HandlerKey = typeof AVAILABLE_COMMANDS[number] | 
    ":message"|
    ":schedule"

export interface GeminiReq{
    event: HandlerKey, payload: CtxCommandData
}
export interface GeminiRes{
    events: Reply[]
}