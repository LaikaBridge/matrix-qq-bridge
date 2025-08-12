export type UserInfo = {
    channel: string,
    users: string[],
}
export interface MumbleBridgeRPC{
    getUsers(): Promise<UserInfo[]>
}