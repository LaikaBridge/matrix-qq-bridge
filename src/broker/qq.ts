import {createClient, RedisClientType} from 'redis';
import {Config} from '../config';
class QQBroker{
    //qqSendQueue: string;
    //qqRecvQueue: string;
    redisClient: RedisClientType;
    constructor(config: Config){
        this.redisClient = createClient({
            url: config.redisConfig.connString
        });
        this.redisClient.on('error', err=>{

        })
        const qqSendQueue = `${config.redisConfig.namespace}-qqSendQueue`;
        const qqRecvQueue = `${config.redisConfig.namespace}-qqRecvQueue`;
    }

}