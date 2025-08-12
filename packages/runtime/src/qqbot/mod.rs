use std::{
  fmt::Debug,
  str::FromStr,
  sync::{Arc, atomic::AtomicBool},
};

use anyhow::{Context, bail};
use async_broadcast::InactiveReceiver;
use hostport::HostPort;
use itertools::Itertools;
use napi::{
  threadsafe_function::ThreadsafeFunction,
  tokio::{
    self,
    sync::{Mutex, OnceCell, RwLock, broadcast, oneshot},
  },
};
use napi_derive::napi;
use onebot_v11::{
  api::{
    payload::{ApiPayload, GetFriendList},
    resp::{ApiResp, ApiRespData},
  },
  connect::ws::{WsConfig, WsConnect},
};
use secrecy::{ExposeSecret, SecretBox, SecretString};
use tracing::{debug, info, instrument, trace};

use crate::qqbot::{
  client_proxy::ClientProxy,
  event::Event,
  export::{GroupMemberInfo, message_to_msgchain},
};

#[derive(Debug)]

pub struct QQBotConfig {
  addr: String,
  access_token: SecretString,
}

pub mod client_proxy;
pub mod event;

pub struct QQBotEndpoint {
  config: QQBotConfig,
  started: Mutex<Option<oneshot::Receiver<()>>>,
  terminated: Mutex<Option<(oneshot::Sender<()>, InactiveReceiver<event::Event>)>>,
  client: OnceCell<Arc<WsConnect>>,
  event_tx: async_broadcast::Sender<event::Event>,
}
impl Debug for QQBotEndpoint {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("QQBotEndpoint")
      .field("config", &self.config)
      .finish_non_exhaustive()
  }
}

impl QQBotEndpoint {
  pub fn new(config: QQBotConfig) -> anyhow::Result<Arc<Self>> {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (event_tx, event_rx) = async_broadcast::broadcast(1024);
    let instance = Self {
      config,
      started: Mutex::new(Some(shutdown_rx)),
      terminated: Mutex::new(Some((shutdown_tx, event_rx.deactivate()))),
      client: OnceCell::new(),
      event_tx,
    };

    Ok(Arc::new(instance))
  }

  pub fn get_client(&self) -> anyhow::Result<ClientProxy<WsConnect>> {
    let client = self
      .client
      .get()
      .ok_or(anyhow::anyhow!("Client not initialized"))?;
    Ok(ClientProxy::new(client.clone()))
  }

  async fn main_loop(&self, mut terminate: oneshot::Receiver<()>) -> anyhow::Result<()> {
    let client = self.get_client()?;
    let mut subscriber = client.0.subscribe().await;
    'main: loop {
      tokio::select! {
          biased;
          maybe_event = subscriber.recv() => {
            let ev = maybe_event?;
            self.handle_onebot_event(ev).await?;
          }
          _ = &mut terminate => {
            info!("QQBot terminating...");
            break 'main;
          }
      }
    }
    Ok(())
  }

  #[instrument]
  async fn handle_onebot_event(&self, ev: onebot_v11::Event) -> anyhow::Result<()> {
    debug!(event =? ev, "OneBot event");
    match ev {
      onebot_v11::Event::Message(message) => match &message {
        onebot_v11::event::message::Message::GroupMessage(m) => 'handle: {
          let Ok(mock_message) = message_to_msgchain(self.get_client()?, &message).await else {
            break 'handle;
          };
          self
            .event_tx
            .broadcast_direct(Event::GroupMessage {
              self_id: m.self_id.to_string(),
              group_id: m.group_id.to_string(),
              sender: GroupMemberInfo {
                user_id: m.sender.user_id.context("No User ID")?.to_string(),
                nick: m.sender.card.clone(),
                name: m.sender.nickname.clone(),
              },
              message: mock_message.1,
            })
            .await?;
        }
        _ => {}
      },
      onebot_v11::Event::Meta(meta) => {
        // heartbeat and lifecycle.
        match meta {
          onebot_v11::event::meta::Meta::Lifecycle(lifecycle) => {
            debug!("Lifecycle: {lifecycle:?}");
          }
          onebot_v11::event::meta::Meta::Heartbeat(heartbeat) => {
            debug!("Heartbeat: {heartbeat:?}");
          }
        }
      }
      onebot_v11::Event::Notice(notice) => match &notice {
        onebot_v11::event::notice::Notice::GroupMessageRecall(m) => {
          self
            .event_tx
            .broadcast_direct(Event::GroupMessageDeleted {
              self_id: m.self_id.to_string(),
              group_id: m.group_id.to_string(),
              message_id: m.message_id.to_string(),
            })
            .await?;
        }
        _ => {}
      },
      onebot_v11::Event::Request(request) => {
        // requests. should not care.
      }
      onebot_v11::Event::ApiRespBuilder(api_resp_builder) => {
        // should not care.
      }
    }
    Ok(())
  }

  pub async fn terminate(&self) -> anyhow::Result<()> {
    let Some((shutdown_tx, _)) = self.terminated.lock().await.take() else {
      bail!("already terminated!");
    };
    let core::result::Result::Ok(()) = shutdown_tx.send(()) else {
      bail!("main thread terminated by error!");
    };
    Ok(())
  }
}

impl QQBotEndpoint {
  #[instrument]
  pub async fn start(self: Arc<Self>) -> anyhow::Result<()> {
    let Some(terminate) = self.started.lock().await.take() else {
      bail!("Already started!");
    };

    info!("QQBot starting, connecting to {}", self.config.addr);

    let parsed_addr = HostPort::from_str(&self.config.addr)?;

    let onebot_config = WsConfig {
      host: parsed_addr.host().to_owned(),
      port: parsed_addr.port() as u16,
      access_token: Some(self.config.access_token.expose_secret().to_owned()),
      ..Default::default()
    };

    let client = WsConnect::new(onebot_config).await?;
    self
      .client
      .set(client.clone())
      .map_err(|_| anyhow::anyhow!("Failed to set client"))?;

    // do a whoami.
    let ApiRespData::GetLoginInfoResponse(login_info) = client
      .call_api(ApiPayload::GetLoginInfo(
        onebot_v11::api::payload::GetLoginInfo {},
      ))
      .await?
      .data
    else {
      bail!("Failed to get login info");
    };
    self
      .event_tx
      .broadcast_direct(event::Event::Connected {
        name: login_info.nickname,
        qq: login_info.user_id.to_string(),
      })
      .await?;
    tokio::spawn(async move { self.main_loop(terminate).await.expect("Main loop failed") });

    info!("QQBot started!");

    Ok(())
  }
  pub fn register_callback(
    &self,
    callback: ThreadsafeFunction<event::Event>,
  ) -> anyhow::Result<()> {
    let mut rx = self.event_tx.new_receiver();
    tokio::spawn(async move {
      while let Ok(next) = rx.recv().await {
        callback.call(
          Ok(next),
          napi::threadsafe_function::ThreadsafeFunctionCallMode::Blocking,
        );
      }
      callback.call(
        Ok(event::Event::Closed),
        napi::threadsafe_function::ThreadsafeFunctionCallMode::Blocking,
      );
    });
    Ok(())
  }
}

pub mod export;

pub mod bytes;
