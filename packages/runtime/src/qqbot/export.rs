use std::{any, fmt::format, sync::Arc};

use crate::qqbot::{bytes::ByteBuffer, client_proxy::ClientProxy, event};
use anyhow::{Context, bail};
use futures_util::future::{join_all, try_join_all};
use itertools::Itertools;
use napi::bindgen_prelude::*;
use napi::{bindgen_prelude::FromNapiValue, threadsafe_function::ThreadsafeFunction};
use napi_derive::napi;
use onebot_v11::{
  MessageSegment,
  api::payload::{DeleteMsg, GetForwardMsg, GetFriendList, GetGroupMemberInfo, SendMsg},
  connect::ws::WsConnect,
  event::message::Message,
  message::segment::ReplyData,
};
use tracing::info;

use super::QQBotEndpoint as Inner;

#[napi(object)]
#[derive(Debug, Clone)]
pub struct QQBotConfig {
  pub addr: String,
  pub access_token: String,
}

impl From<QQBotConfig> for super::QQBotConfig {
  fn from(value: QQBotConfig) -> Self {
    super::QQBotConfig {
      addr: value.addr,
      access_token: value.access_token.into(),
    }
  }
}

#[napi]
pub struct QQBotEndpoint {
  inner: Arc<Inner>,
}

#[napi(object)]
pub struct MemberInfo {
  pub nick: String,
  pub name: String,
}

#[napi]
impl QQBotEndpoint {
  #[napi(constructor)]
  pub fn new(config: QQBotConfig) -> anyhow::Result<Self> {
    Ok(Self {
      inner: Inner::new(config.into())?,
    })
  }
  pub fn client(&self) -> anyhow::Result<ClientProxy<WsConnect>> {
    self.inner.get_client()
  }
  #[napi]
  pub async fn start(&self) -> anyhow::Result<()> {
    self.inner.clone().start().await
  }
  #[napi]
  pub async fn terminate(&self) -> anyhow::Result<()> {
    self.inner.terminate().await
  }
  #[napi]
  pub async fn register_callback(
    &self,
    callback: ThreadsafeFunction<event::Event>,
  ) -> anyhow::Result<()> {
    self.inner.register_callback(callback)
  }
  #[napi]
  pub async fn get_friend_list(&self) -> anyhow::Result<Vec<(String, String)>> {
    info!("get friend list");
    let client = self.client()?;
    let resp = client.get_friend_list(GetFriendList {}).await?;
    Ok(
      resp
        .iter()
        .map(|x| (x.user_id.to_string(), x.nickname.clone()))
        .collect_vec(),
    )
  }
  #[napi]
  pub async fn get_group_member(
    &self,
    group_id: String,
    user_id: String,
  ) -> anyhow::Result<GroupMemberInfo> {
    let group_id = parse_qq_id(&group_id)?;
    let user_id = parse_qq_id(&user_id)?;
    let resp = self
      .client()?
      .get_group_member_info(GetGroupMemberInfo {
        group_id,
        user_id,
        no_cache: false,
      })
      .await?;

    Ok(GroupMemberInfo {
      user_id: user_id.to_string(),
      nick: Some(resp.card),
      name: Some(resp.nickname),
    })
  }
  #[napi]
  pub async fn delete_message(&self, message_id: String) -> anyhow::Result<()> {
    self
      .client()?
      .delete_msg(DeleteMsg {
        message_id: parse_qq_id(&message_id)?,
      })
      .await?;
    Ok(())
  }

  #[napi]
  pub async fn send_group_message(
    &self,
    group_id: String,
    message: Vec<Mockv2MessageChain>,
  ) -> anyhow::Result<SendGroupMsgResp> {
    let segments = msgchain_to_segments(&message)?;
    let resp = self
      .client()?
      .send_msg(SendMsg {
        message_type: onebot_v11::api::payload::MessageType::Group,
        group_id: Some(parse_qq_id(&group_id)?),
        auto_escape: false,
        user_id: None,
        message: segments,
      })
      .await?;
    Ok(SendGroupMsgResp {
      message_id: resp.message_id.to_string(),
    })
  }
  /*
  #[napi]
  pub async fn get_forward_msg(&self, message_id: String) -> anyhow::Result<()> {
    let resp = self
      .client()?
      .get_forward_msg(GetForwardMsg { id: message_id })
      .await?;

    Ok(())
  }
  */
}

#[napi(object)]
#[derive(Clone)]
pub struct SendGroupMsgResp {
  pub message_id: String,
}
fn parse_qq_id(s: &str) -> anyhow::Result<i64> {
  let s = s.parse::<i64>()?;
  Ok(s)
}

pub fn msgchain_to_segments(
  msgchain: &[Mockv2MessageChain],
) -> anyhow::Result<Vec<MessageSegment>> {
  let mut segments = vec![];
  for msg in msgchain.iter() {
    match msg {
      Mockv2MessageChain::Quote { id } => {
        segments.push(MessageSegment::reply(id));
      }
      Mockv2MessageChain::Plain { text } => {
        segments.push(MessageSegment::text(text));
      }
      Mockv2MessageChain::At { target, display } => {
        segments.push(MessageSegment::at(target.to_string()));
      }
      Mockv2MessageChain::ImageOutbound { buffer, mime } => {
        let base64 =
          base64::engine::Engine::encode(&base64::engine::general_purpose::STANDARD, &buffer.0);
        segments.push(MessageSegment::easy_image(
          format!("base64://{}", base64),
          None::<&str>,
        ));
      }
      Mockv2MessageChain::Source { id } => {}
      _ => {
        bail!("Unsupported message type {:?}", msg)
      }
    }
  }
  Ok(segments)
}

pub async fn message_to_msgchain(
  client: ClientProxy<WsConnect>,
  message: &Message,
) -> anyhow::Result<(String, Vec<Mockv2MessageChain>)> {
  let unnamed = "未知用户".to_owned();
  let (name, id, body) = match message {
    onebot_v11::event::message::Message::PrivateMessage(private_message) => (
      private_message.sender.nickname.as_ref().unwrap_or(&unnamed),
      private_message.message_id,
      &private_message.message,
    ),
    onebot_v11::event::message::Message::GroupMessage(group_message) => (
      group_message
        .sender
        .card
        .as_ref()
        .unwrap_or_else(|| group_message.sender.nickname.as_ref().unwrap_or(&unnamed)),
      group_message.message_id,
      &group_message.message,
    ),
  };
  let client = client.clone();
  let body = body
    .iter()
    .map(|y| message_segment_to_msgchain(client.clone(), y))
    .collect_vec();
  let mut body = try_join_all(body).await?;
  body.insert(0, Mockv2MessageChain::Source { id: id.to_string() });
  Ok((name.to_owned(), body))
}

pub async fn message_segment_to_msgchain(
  client: ClientProxy<WsConnect>,
  segment: &MessageSegment,
) -> anyhow::Result<Mockv2MessageChain> {
  Ok(match segment {
    MessageSegment::Text { data } => Mockv2MessageChain::Plain {
      text: data.text.to_owned(),
    },
    MessageSegment::At { data } => Mockv2MessageChain::At {
      target: parse_qq_id(&data.qq)?,
      display: None,
    },
    MessageSegment::Image { data } => Mockv2MessageChain::ImageInbound {
      url: data
        .url
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("No Inbound URL"))?
        .clone(),
      image_id: None,
    },
    MessageSegment::Reply { data } => Mockv2MessageChain::Quote {
      id: data.id.to_owned(),
    },
    MessageSegment::Forward { data } => Mockv2MessageChain::Forward {
      node_list: {
        let Some(messages) = data.content.as_ref() else {
          // soft error
          return Ok(Mockv2MessageChain::Error {
            message: format!("获取Forward信息失败: {}", data.id),
          });
        };
        let messages = messages
          .into_iter()
          .map(async |x| {
            let (sender, message_chain) = message_to_msgchain(client.clone(), x).await?;
            Ok::<_, anyhow::Error>(ForwardItem {
              sender_name: sender,
              message_chain,
            })
          })
          .collect_vec();
        let messages = try_join_all(messages).await?;
        messages
      },
    },
    obj => {
      let tag = serde_json::to_value(obj)?;
      let tag = tag
        .as_object()
        .context("wtf")?
        .get("type")
        .context("wtf")?
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("wtf"))?;
      Mockv2MessageChain::Unknown {
        placeholder: tag.to_owned(),
      }
    }
  })
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct GroupMemberInfo {
  pub user_id: String,
  pub nick: Option<String>,
  pub name: Option<String>,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ForwardItem {
  pub sender_name: String,
  pub message_chain: Vec<Mockv2MessageChain>,
}

#[napi]
#[derive(Debug, Clone)]
pub enum Mockv2MessageChain {
  Forward {
    node_list: Vec<ForwardItem>,
  },
  Quote {
    id: String,
  },
  Plain {
    text: String,
  },
  At {
    target: i64,
    display: Option<String>,
  },
  Source {
    id: String,
  },
  ImageInbound {
    url: String,
    image_id: Option<String>,
  },
  ImageOutbound {
    #[napi(ts_type = "Uint8Array")]
    buffer: ByteBuffer,
    mime: String,
  },
  Unknown {
    placeholder: String,
  },
  Error {
    message: String,
  },
}

#[napi]
fn test_uint8array(elem: Mockv2MessageChain) {
  println!("{:?}", elem);
}
