import * as net from 'net'
import { client } from '../clients/mq'
import { getLogger } from '../utils'

interface LocationMessage {
  IMSI: string
  UTC: number
  Latitude: number
  Longitude: number
  Altitude: number
  Speed: number
  Direction: number
  Volts: number
}

const PORT = process.env.NODE_ENV === 'development' ? 15678 : 5678
const logger = getLogger('TCP')

const server = net.createServer(function (socket) {
  logger('Client connected')

  socket.on('data', function (data) {
	if (data[0] !== 0x7E || data[data.length - 1] !== 0x7E) {
      // 数据不符合条件，跳过当前循环
	  socket.write('Invalid Upload GPS payload')
      return;
    }
    data = unescape(data);
    const commandId = data.slice(1, 3);
    const imei = data.slice(5, 11);
    const seqId = data.slice(11, 13);
    let replyData;

    // 处理 0200 位置数据包
    if (commandId.compare(Buffer.from([0x02, 0x00])) === 0) {
      // 解析位置信息
      let location = parse0200(data.slice(13), imei);
	  client.publishGPS(location);
      logger('0200', location);
      // 构造回复数据
      replyData = buildReply8001(imei, seqId, commandId);
    }
    // 处理 0704 位置数据包
    else if (commandId.compare(Buffer.from([0x07, 0x04])) === 0) {
      // 解析位置信息
      const locations = parse0704(data.slice(13), imei);
      for (let i = 0; i < locations.length; i++) {
        let location = locations[i];
		client.publishGPS(location);
        logger('0704', location);
      }
      // 构造回复数据
      replyData = buildReply8001(imei, seqId, commandId);
    }
    // 处理 0100 鉴权数据包
    else if (commandId.compare(Buffer.from([0x01, 0x00])) === 0) {
      // 不解析注册信息
      // 构造回复数据
      replyData = buildReply8100(imei, seqId);
    }
    // 处理 0002注册/0102鉴权 数据包
    else if (
      commandId.compare(Buffer.from([0x00, 0x02])) === 0 ||
      commandId.compare(Buffer.from([0x01, 0x02])) === 0
    ) {
      // 终端心跳数据消息体为空
      // 构造回复数据
      replyData = buildReply8001(imei, seqId, commandId);
    }

    // 发送回复数据
    if (replyData !== undefined) {
      socket.write(replyData);
    }
  })

  socket.on('end', function () {
    logger('Client disconnected')
  })

  socket.on('error', function (err) {
    logger.error(`Error: ${err}`)
  })
})

server.listen(PORT, function () {
  logger(`TCP Server started on port ${PORT}`)
})

// 解析位置信息
function parse0200(data: Buffer, imei: Buffer): LocationMessage {
  const location = {
    IMSI: bcdToDec(imei).toString(),
    Longitude: data.readUInt32BE(12) / 1000000,
    Latitude: data.readUInt32BE(8) / 1000000,
    Altitude: data.readUInt16BE(16),
    Speed: data.readUInt16BE(18),
    Direction: data.readUInt16BE(20),
    UTC: bcdToDatetime(data.slice(22, 28)),
    Volts: 12,
  };

  // 获取位置信息
  // 解imei
  return location;
}

function parse0704(msgBody: Buffer, imei: Buffer): LocationMessage[] {
  // Parse header
  const count = msgBody.readUInt16BE(0);
  // locationType = msgBody[2:3];
  // console.log('[Tx JT808 0704 type]', locationType);
  msgBody = msgBody.slice(3);

  const results: LocationMessage[] = [];
  for (let i = 1; i < count; i++) {
    const length = msgBody.readUInt16BE(0);
    const location = parse0200(msgBody.slice(2, 2 + length), imei);
    msgBody = msgBody.slice(2 + length);
    results.push(location);
  }

  return results;
}

// 计算校验码
function calcCheckCode(data: Buffer): Buffer {
  let checkCode = 0;
  for (const byte of data) {
    checkCode ^= byte;
  }

  return Buffer.from([checkCode]);
}

function buildReply8100(imei: Buffer, seqId: Buffer): Buffer {
  // 组装回复消息
  const msgBody = Buffer.concat([seqId, Buffer.from([0x00, 0x49, 0x00, 0x62, 0x46, 0x45])]);
  const msgHead = Buffer.concat([
    Buffer.from([0x81, 0x00]),
    Buffer.from(msgBody.length.toString(16).padStart(4, '0'), 'hex'),
    imei,
    seqId,
  ]);
  const replyMsg = Buffer.concat([msgHead, msgBody]);
  const checkCode = calcCheckCode(replyMsg);
  // 组装完整的回复消息
  const replyData = Buffer.concat([Buffer.from([0x7E]), escape(Buffer.concat([replyMsg, checkCode])), Buffer.from([0x7E])]);
  return replyData;
}

function buildReply8001(imei: Buffer, seqId: Buffer, cmdId: Buffer): Buffer {
  // 组装回复消息
  const msgBody = Buffer.concat([seqId, cmdId, Buffer.from([0x00])]);
  const msgHead = Buffer.concat([
    Buffer.from([0x80, 0x01]),
    Buffer.from(msgBody.length.toString(16).padStart(4, '0'), 'hex'),
    imei,
    seqId,
  ]);
  const replyMsg = Buffer.concat([msgHead, msgBody]);
  const checkCode = calcCheckCode(replyMsg);
  // 组装完整的回复消息
  const replyData = Buffer.concat([Buffer.from([0x7E]), escape(Buffer.concat([replyMsg, checkCode])), Buffer.from([0x7E])]);
  return replyData;
}

// BCD 转换为日期时间
function bcdToDatetime(bcd: Buffer): number {
  const year = bcdToDec(bcd.slice(0, 1)) + 2000;
  const month = bcdToDec(bcd.slice(1, 2));
  const day = bcdToDec(bcd.slice(2, 3));
  const hour = bcdToDec(bcd.slice(3, 4));
  const minute = bcdToDec(bcd.slice(4, 5));
  const second = bcdToDec(bcd.slice(5, 6));
  return new Date(year, month , day, hour, minute, second).getTime();
}

// 将 JT808 数据包中的转义字符进行反转义
function unescape(data: Buffer): Buffer {
  let result = Buffer.alloc(0);
  let i = 0;

  while (i < data.length) {
    if (data[i] === 0x7D) {
      if (data[i + 1] === 0x02) {
        result = Buffer.concat([result, Buffer.from([0x7E])]);
        i += 2;
      } else if (data[i + 1] === 0x01) {
        result = Buffer.concat([result, Buffer.from([0x7D])]);
        i += 2;
      } else {
        result = Buffer.concat([result, data.slice(i, i + 2)]);
        i += 2;
      }
    } else {
      result = Buffer.concat([result, Buffer.from([data[i]])]);
      i += 1;
    }
  }

  return result;
}

// Convert a buffer of BCD-encoded digits to a decimal number
function bcdToDec(bcd: Buffer): number {
  let result = 0;
  for (const digit of bcd) {
    result = result * 100 + ((digit >> 4) * 10 + (digit & 0x0F));
  }
  return result;
}

// Escape special characters in a buffer for JT808 protocol
function escape(data: Buffer): Buffer {
  const result: Buffer[] = [];
  for (const byte of data) {
    if (byte === 0x7E) {
      result.push(Buffer.from([0x7D, 0x02]));
    } else if (byte === 0x7D) {
      result.push(Buffer.from([0x7D, 0x01]));
    } else {
      result.push(Buffer.from([byte]));
    }
  }
  return Buffer.concat(result);
}
