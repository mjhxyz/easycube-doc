// 定义变量
let expectedFrameLength = 0;
let frameBuffer = Buffer.alloc(0);
let lastAck = 0;
let unacknowledgedFrames = [];
let retransmissionCount = 0;
const MAX_RETRANSMISSION_COUNT = 3;

const HEADER = 0xaa
const encoder = new TextEncoder();

Number.prototype.toB = function (length) {
  let byteArray = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    byteArray[length - 1 - i] = (this >>> (i * 8)) & 0xff;
  }
  return byteArray;
}

Uint8Array.prototype.concat = function (o) {
  return new Uint8Array([...this, ...o])
}

Uint8Array.prototype.toString = function () {
  let result = [];
  for (const byte of this) {
    result.push(byte.toString(16).padStart(2, '0'))
  }
  return result.join(" ")
}

String.prototype.toB = function () {
  const uint8array = encoder.encode(this);
  return uint8array;
}

Uint8Array.prototype.toI = function () {
  let value = 0;
  for (let i = 0; i < this.length; i++) {
    value = (value << 8) | this[i];
  }
  return value;
}

function b(...args) {
  return new Uint8Array([...args]);
}

function concatB(a1, a2) {
  return new Uint8Array([...a1, ...a2])
}

let buffer = Uint8Array();


// onData 方法实现

// 消息头 功能字 序号 数据长度 数据 校验码 时间戳  
function onData(data) {
  if (!data) {
    return null;
  }

  buffer = buffer.concat(data)
  let cur = 0; // 当前解析到的位置

  while (cur < buffer.length) {  // 寻找 header
    let header = buffer[cur]
    if (header === 0xaa) {  // 找到 header
      break;
    }
    cur += 1
  }

  // 操作字 1B
  if (cur >= buffer.length) {
    return; // 没有更多的数据了
  }
  let tp = buffer[cur]
  cur += 1

  // 序号 2B
  if (cur + 1 >= buffer.length) {
    return;
  }
  let seq = buffer.subarray(cur, cur + 2).toI()
  cur += 2

  if (tp === 0x01) { // ack
    // 从未确认帧列表中移除已确认的帧
    unacknowledgedFrames = unacknowledgedFrames.filter((frame) => frame.seq != seq);
    buffer = buffer.subarray(cur + 1) // 更新缓冲区
    return;
  } else if (tp === 0x02) { // nack
    // TODO 重发数据包
    buffer = buffer.subarray(cur + 1) // 更新缓冲区
    return;
  }


  // 收到数据了
  // 数据长度 2B
  if (cur + 1 >= buffer.length) {
    return;
  }
  let dataLength = buffer.subarray(cur, cur + 2).toI()
  cur += 2

  // 数据部分 {dataLength}B
  if (cur + dataLength - 1 >= buffer.length) {
    return;
  }
  let packageData = buffer.subarray(cur, cur + dataLength)
  cur += dataLength

  // 校验码 1B
  if (cur >= buffer.length) {
    return;
  }
  let checkSum = buffer[cur]
  cur += 1
  // 后面还有个时间戳 暂时不检查校验和, 要不然写起来麻烦

  // 时间戳 4B
  if (cur + 3 >= buffer.length) {
    return;
  }
  let ts = buffer.subarray(cur, cur + 4).toI()
  cur += 4;

  // 更新缓冲区
  buffer = buffer.subarray(cur)

  // TODO 检查时间戳
  // ....

  // 检查校验码
  let expectedCheckSum = calculateChecksum(data)
  if (expectedCheckSum !== checkSum) {
    // TODO 发送 nack
    return null;
  } else {
    // TODO: 发送 ack
    return data;
  }

  while (frameBuffer.length >= expectedFrameLength && expectedFrameLength > 0) {
    const frameData = frameBuffer.slice(0, expectedFrameLength);
    frameBuffer = frameBuffer.slice(expectedFrameLength);
    expectedFrameLength = 0;

    if (verifyChecksum(frameData)) {
      const timestamp = parseTimestamp(frameData.slice(frameData.length - 5, frameData.length - 1));
      if (timestampIsValid(timestamp)) {
        const sequenceNumber = frameData.readUInt16BE(1);
        const dataLength = frameData.readUInt16BE(3);
        const payload = frameData.slice(5, 5 + dataLength);

        if (sequenceNumber === lastAck + 1) {
          processFrameData(payload);
          lastAck = sequenceNumber;

          // 发送确认帧
          const ackFrame = Buffer.alloc(4);
          ackFrame.writeUInt8(0x01, 0);
          ackFrame.writeUInt16BE(lastAck + 1, 1);
          const checksum = calculateChecksum(ackFrame);
          ackFrame.writeUInt8(checksum, 3);
          sendData(ackFrame);

          // 从未确认帧列表中移除已确认的帧
          unacknowledgedFrames = unacknowledgedFrames.filter((frame) => frame.sequenceNumber > lastAck);
          retransmissionCount = 0;
        } else if (sequenceNumber > lastAck + 1) {
          console.log(`Received out-of-order frame with sequence number ${sequenceNumber}, buffering...`);
          unacknowledgedFrames.push({ sequenceNumber, payload });

          // 发送确认帧
          const ackFrame = Buffer.alloc(4);
          ackFrame.writeUInt8(0x01, 0);
          ackFrame.writeUInt16BE(lastAck + 1, 1);
          const checksum = calculateChecksum(ackFrame);
          ackFrame.writeUInt8(checksum, 3);
          sendData(ackFrame);
        }
      } else {
        console.log(`Invalid timestamp in frame: ${timestamp}`);
      }
    } else {
      console.log('Checksum verification failed');
    }
  }
}

// 发送数据帧的方法实现
function sendFrame(sequenceNumber, payload) {
  const dataLength = payload.length;
  const frameLength = 10 + dataLength;
  const frame = Buffer.alloc(frameLength);
  frame.writeUInt8(0x02, 0);
  frame.writeUInt16BE(sequenceNumber, 1);
  frame.writeUInt16BE(dataLength, 3);
  payload.copy(frame, 5);
  const checksum = calculateChecksum(frame);
  frame.writeUInt8(checksum, frameLength - 5);
  const timestamp = getCurrentTimestamp();
  timestamp.copy(frame, frameLength - 4);
  sendData(frame);

  // 将数据帧加入未确认帧列表
  unacknowledgedFrames.push({ sequenceNumber, payload });

  // 设置超时重传定时器
  setTimeout(() => {
    if (unacknowledgedFrames.find((frame) => frame.sequenceNumber === sequenceNumber)) {
      console.log(`Frame with sequence number ${sequenceNumber} timed out, retransmitting...`);
      sendData(frame);
      retransmissionCount++;
      if (retransmissionCount < MAX_RETRANSMISSION_COUNT) {
        // 重新设置超时重传定时器
        setTimeout(() => {
          if (unacknowledgedFrames.find((frame) => frame.sequenceNumber === sequenceNumber)) {
            console.log(`Frame with sequence number ${sequenceNumber} timed out, retransmitting again...`);
            sendData(frame);
            retransmissionCount++;
          }
        }, 1000);
      } else {
        console.log(`Frame with sequence number ${sequenceNumber} has exceeded maximum retransmission count`);
        unacknowledgedFrames = unacknowledgedFrames.filter((frame) => frame.sequenceNumber > sequenceNumber);
        retransmissionCount = 0;
      }
    }
  }, 1000);
}

// 处理接收到的数据帧数据的方法实现
function processFrameData(payload) {
  console.log(`Received payload: ${payload}`);
}

// 计算校验和的方法实现
function calculateChecksum(data) {
  let checksum = 0;
  for (let i = 0; i < data.length; i++) {
    checksum ^= data[i];
  }
  return checksum;
}

// 验证校验和的方法实现
function verifyChecksum(frameData) {
  const checksum = frameData[frameData.length - 5];
  return calculateChecksum(frameData.slice(0, frameData.length - 5)) === checksum;
}

// 解析时间戳的方法实现
function parseTimestamp(data) {
  return new Date(data.readUInt32BE(0) * 1000);
}

// 检查时间戳是否有效的方法实现
function timestampIsValid(timestamp) {
  const now = new Date();
  const maxTimestampAge = 10000; // 10 秒
  return now.getTime() - timestamp.getTime() < maxTimestampAge;
}

// 获取当前时间戳的方法实现
function getCurrentTimestamp() {
  const timestamp = Buffer.alloc(4);
  const now = Math.floor(Date.now() / 1000);
  timestamp.writeUInt32BE(now, 0);
  return timestamp;
}