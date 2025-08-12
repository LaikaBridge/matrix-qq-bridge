use napi_derive::napi;

use crate::qqbot::export::{GroupMemberInfo, Mockv2MessageChain};

#[napi]
#[derive(Clone)]
pub enum Event {
  Connected {
    name: String,
    qq: String,
  },
  GroupMessage {
    self_id: String,
    group_id: String,
    sender: GroupMemberInfo,
    message: Vec<Mockv2MessageChain>,
  },
  GroupMessageDeleted {
    group_id: String,
    self_id: String,
    message_id: String,
  },
  Closed,
}
