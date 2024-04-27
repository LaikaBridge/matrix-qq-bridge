import {describe, expect, test} from '@jest/globals';
import {RedisClientType, createClient} from 'redis';
import {Producer, Consumer} from '../../src/broker/msgqueue';

import crypto from 'crypto';

function generateRandomString(length: number): string {
  const randomBytes = crypto.randomBytes(length);
  const randomString = randomBytes.toString('base64');
  return randomString.substring(0, length);
}
function createDataset(size: number, keyLength: number = 100): string[] {
    return [...Array(size)].map((_, i) => `${i}:${generateRandomString(keyLength)}`);
}

async function withPair<T, U>(fn: (producer: Producer<T>, consumer: Consumer<T>, resetConsumer: ()=>Consumer<T>) => Promise<U>): Promise<U>{
    const clientProducer = createClient() as RedisClientType;
    const clientConsumer = createClient() as RedisClientType;
    await clientProducer.connect();
    await clientConsumer.connect();

    const stream = "MSGQUEUE_STREAM_TEST_" + generateRandomString(10);
    await clientConsumer.DEL(stream);
    console.log(`Using stream ${stream}`);
    const consumer = new Consumer<T>(clientConsumer, stream);
    const producer = new Producer<T>(clientProducer, stream);
    
    try{
        const result = await fn(producer, consumer, ()=>{
            return new Consumer<T>(clientConsumer, stream);
        });
        return result;
    }finally{
        console.log(`Cleaning up stream ${stream}`);
        await clientConsumer.DEL(stream);
        await clientConsumer.QUIT();
        await clientProducer.QUIT();
    }
}

describe('msgqueue test', () => {
    test('simple consumer test', async () => {
        const data = createDataset(100);
        const rx: string[] = [];
        await withPair<string, void>(async (producer, consumer) => {
            const fin = (async () => {
                for(let i=0; i<data.length; i++){
                    const d = await consumer.next();
                    rx.push(d[1]);
                    consumer.commit(d[0]);
                }
            })();
            for (const d of data) {
                await producer.push(d);
            }
            await fin;
        });
        expect(rx).toEqual(data);
    });
    test('simple unreliable consumer test', async ()=>{
        const data = createDataset(100);
        const rx: string[] = [];
        await withPair<string, void>(async (producer, consumer, resetConsumer) => {
            for (const d of data) {
                await producer.push(d);
            }
            const fin = (async () => {
                for(let i=0; i<data.length; i++){
                    const d = await consumer.next();
                    // not commiited yet.
                    if(i%7==6){
                        //console.log("Pre-crash", consumer.pending, consumer.loaded);
                        // emulate crash once.
                        consumer = resetConsumer();
                        const d2 = await consumer.next();
                        rx.push(d2[1]);
                        await consumer.commit(d2[0]);
                        //console.log(`Committing [${d2[0]}]${d2[1]} post-crash, iter: ${i}`)
                        //console.log("Post-crash", consumer.pending, consumer.loaded);
                        expect(d).toEqual(d2);
                    }else{
                        rx.push(d[1]);
                        await consumer.commit(d[0]);
                        //console.log(`Committing [${d[0]}]${d[1]} as-is, iter: ${i}`)
                    }

                }
            })();

            await fin;
        });
        expect(rx).toEqual(data);
    });
});