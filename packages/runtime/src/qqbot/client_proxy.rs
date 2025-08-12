use std::sync::Arc;

use anyhow::bail;
use onebot_v11::{
  api::{payload::ApiPayload, resp::ApiResp},
  connect::ws::WsConnect,
};

pub trait ClientRaw {
  fn call_api_raw(
    self: Arc<Self>,
    api_data: ApiPayload,
  ) -> impl std::future::Future<Output = anyhow::Result<ApiResp>>;
}

impl ClientRaw for WsConnect {
  async fn call_api_raw(self: Arc<Self>, api_data: ApiPayload) -> anyhow::Result<ApiResp> {
    self.call_api(api_data).await
  }
}

pub struct ClientProxy<C>(pub Arc<C>);

impl<C: ClientRaw> ClientProxy<C> {
  pub fn new(client: Arc<C>) -> Self {
    Self(client)
  }
}

impl<C> Clone for ClientProxy<C> {
  fn clone(&self) -> Self {
    Self(self.0.clone())
  }
}

macro_rules! impl_api {
  (
        $fn_name:ident,
        $api_name:ident,
        $resp_variant:ident,
        $resp_type:ty
    ) => {
    #[doc = "代理函数，调用 onebot v11 API: `"]
    #[doc = stringify!($fn_name)]
    #[doc = "`"]
    pub async fn $fn_name(
      self,
      arg: onebot_v11::api::payload::$api_name,
    ) -> anyhow::Result<$resp_type> {
      use onebot_v11::api::payload::ApiPayload::$api_name as Ctor;
      use onebot_v11::api::resp::ApiRespData::$resp_variant as Dtor;

      let client = self.0;
      // 调用底层方法，并传入构造好的 Payload
      let resp = client.call_api_raw(Ctor(arg)).await?;

      // 使用 let-else 优雅地解构响应，如果类型不匹配则返回错误
      let Dtor(resp) = resp.data else {
        bail!(
          "unexpected response type! expected {}, got {:?}",
          stringify!(onebot_v11::api::resp::ApiRespData::$resp_variant),
          resp.data
        );
      };

      Ok(resp)
    }
  };
}

use onebot_v11::api::resp::*;
impl<C: ClientRaw> ClientProxy<C> {
  // =================================================================
  //                      标准 OneBot V11 API
  // =================================================================

  // --- 有特定响应数据的 API ---
  impl_api!(
    send_private_msg,
    SendPrivateMsg,
    SendPrivateMsgResponse,
    SendPrivateMsgResponse
  );
  impl_api!(
    send_group_msg,
    SendGroupMsg,
    SendGroupMsgResponse,
    SendGroupMsgResponse
  );
  impl_api!(send_msg, SendMsg, SendMsgResponse, SendMsgResponse);
  impl_api!(delete_msg, DeleteMsg, DeleteMsgResponse, DeleteMsgResponse);
  impl_api!(get_msg, GetMsg, GetMsgResponse, GetMsgResponse);
  impl_api!(
    get_forward_msg,
    GetForwardMsg,
    GetForwardMsgResponse,
    GetForwardMsgResponse
  );
  impl_api!(
    get_login_info,
    GetLoginInfo,
    GetLoginInfoResponse,
    GetLoginInfoResponse
  );
  impl_api!(
    get_stranger_info,
    GetStrangerInfo,
    GetStrangerInfoResponse,
    GetStrangerInfoResponse
  );
  impl_api!(
    get_group_info,
    GetGroupInfo,
    GetGroupInfoResponse,
    GetGroupInfoResponse
  );
  impl_api!(
    get_group_member_info,
    GetGroupMemberInfo,
    GetGroupMemberInfoResponse,
    GetGroupMemberInfoResponse
  );
  impl_api!(
    get_group_honor_info,
    GetGroupHonorInfo,
    GetGroupHonorInfoResponse,
    GetGroupHonorInfoResponse
  );
  impl_api!(
    get_cookies,
    GetCookies,
    GetCookiesResponse,
    GetCookiesResponse
  );
  impl_api!(
    get_csrf_token,
    GetCsrfToken,
    GetCsrfTokenResponse,
    GetCsrfTokenResponse
  );
  impl_api!(
    get_credentials,
    GetCredentials,
    GetCredentialsResponse,
    GetCredentialsResponse
  );
  impl_api!(get_record, GetRecord, GetRecordResponse, GetRecordResponse);
  impl_api!(get_image, GetImage, GetImageResponse, GetImageResponse);
  impl_api!(
    can_send_image,
    CanSendImage,
    CanSendImageResponse,
    CanSendImageResponse
  );
  impl_api!(
    can_send_record,
    CanSendRecord,
    CanSendRecordResponse,
    CanSendRecordResponse
  );
  impl_api!(get_status, GetStatus, GetStatusResponse, GetStatusResponse);
  impl_api!(
    get_version_info,
    GetVersionInfo,
    GetVersionInfoResponse,
    GetVersionInfoResponse
  );

  // --- 返回列表的 API ---
  impl_api!(
    get_friend_list,
    GetFriendList,
    GetFriendListResponse,
    Vec<GetFriendListResponseItem>
  );
  impl_api!(
    get_group_list,
    GetGroupList,
    GetGroupListResponse,
    Vec<GetGroupListResponseItem>
  );
  impl_api!(
    get_group_member_list,
    GetGroupMemberList,
    GetGroupMemberListResponse,
    Vec<GetGroupMemberListResponseItem>
  );

  // --- 没有特定响应数据的 API (返回 NoResponse) ---
  impl_api!(send_like, SendLike, NoResponse, Option<()>);
  impl_api!(set_group_kick, SetGroupKick, NoResponse, Option<()>);
  impl_api!(set_group_ban, SetGroupBan, NoResponse, Option<()>);
  impl_api!(
    set_group_anonymous_ban,
    SetGroupAnonymousBan,
    NoResponse,
    Option<()>
  );
  impl_api!(
    set_group_whole_ban,
    SetGroupWholeBan,
    NoResponse,
    Option<()>
  );
  impl_api!(set_group_admin, SetGroupAdmin, NoResponse, Option<()>);
  impl_api!(
    set_group_anonymous,
    SetGroupAnonymous,
    NoResponse,
    Option<()>
  );
  impl_api!(set_group_card, SetGroupCard, NoResponse, Option<()>);
  impl_api!(set_group_name, SetGroupName, NoResponse, Option<()>);
  impl_api!(set_group_leave, SetGroupLeave, NoResponse, Option<()>);
  impl_api!(
    set_group_special_title,
    SetGroupSpecialTitle,
    NoResponse,
    Option<()>
  );
  impl_api!(
    set_friend_add_request,
    SetFriendAddRequest,
    NoResponse,
    Option<()>
  );
  impl_api!(
    set_group_add_request,
    SetGroupAddRequest,
    NoResponse,
    Option<()>
  );
  impl_api!(set_restart, SetRestart, NoResponse, Option<()>);
  impl_api!(clean_cache, CleanCache, NoResponse, Option<()>);

  // =================================================================
  //                NapCat / llOneBot / GoCq 扩展 API
  // =================================================================

  // --- 有特定响应数据的 API ---
  impl_api!(
    get_group_system_msg,
    GetGroupSystemMsg,
    GetGroupSystemMsgResponse,
    GetGroupSystemMsgResponse
  );
  impl_api!(get_file, GetFile, GetFileResponse, GetFileResponse);
  impl_api!(
    get_group_file_count,
    GetGroupFileCount,
    GetGroupFileCountResponse,
    GetGroupFileCountResponse
  );
  impl_api!(
    get_group_file_list,
    GetGroupFileList,
    GetGroupFileListResponse,
    GetGroupFileListResponse
  );
  impl_api!(
    set_group_file_folder,
    SetGroupFileFolder,
    SetGroupFileFolderResponse,
    SetGroupFileFolderResponse
  );
  impl_api!(
    del_group_file,
    DelGroupFile,
    DelGroupFileResponse,
    DelGroupFileResponse
  );
  impl_api!(
    send_group_forward_msg,
    SendGroupForwardMsg,
    SendGroupForwardMsgResponse,
    SendGroupForwardMsgResponse
  );
  impl_api!(
    send_private_forward_msg,
    SendPrivateForwardMsg,
    SendPrivateForwardMsgResponse,
    SendPrivateForwardMsgResponse
  );

  // --- 返回列表的 API ---
  impl_api!(
    get_friends_with_category,
    GetFriendsWithCategory,
    GetFriendsWithCategoryResponse,
    Vec<GetFriendsWithCategoryResponseItem>
  );
  impl_api!(
    get_robot_uin_range,
    GetRobotUinRange,
    GetRobotUinRangeResponse,
    Vec<GetRobotUinRangeResponseItem>
  );

  // --- 没有特定响应数据的 API (返回 NoResponse) ---
  impl_api!(set_qq_avatar, SetQQAvatar, NoResponse, Option<()>);
  impl_api!(
    forward_friend_single_msg,
    ForwardFriendSingleMsg,
    NoResponse,
    Option<()>
  );
  impl_api!(
    forward_group_single_msg,
    ForwardGroupSingleMsg,
    NoResponse,
    Option<()>
  );
  impl_api!(set_msg_emoji_like, SetMsgEmojiLike, NoResponse, Option<()>);
  impl_api!(
    mark_private_msg_as_read,
    MarkPrivateMsgAsRead,
    NoResponse,
    Option<()>
  );
  impl_api!(
    mark_group_msg_as_read,
    MarkGroupMsgAsRead,
    NoResponse,
    Option<()>
  );
  impl_api!(set_online_status, SetOnlineStatus, NoResponse, Option<()>);

  // --- 使用通用响应的 API ---
  impl_api!(
    del_group_file_folder,
    DelGroupFileFolder,
    DelGroupFileFolderResponse,
    CommonClientResponseResult
  );
}
