# linux 串口开发

1. 安装 socat 工具。在终端中输入以下命令：
```bash
sudo socat -d -d pty,raw,echo=0 pty,raw,echo=0
```
2. 创建两个虚拟串口。在终端中输入以下命令：
```bash
sudo socat -d -d pty,raw,echo=0 pty,raw,echo=0
```
这将创建两个虚拟串口，输出类似于以下内容：
```bash
2023/03/08 16:36:18 socat[3748] N PTY is /dev/pts/0
2023/03/08 16:36:18 socat[3748] N PTY is /dev/pts/2
2023/03/08 16:36:18 socat[3748] N starting data transfer loop with FDs [5,5] and [7,7]
```
在这个例子中，创建了两个虚拟串口，分别为 /dev/pts/3 和 /dev/pts/4。
3. 设置虚拟串口的权限。在终端中输入以下命令：

```bash
sudo chmod 666 /dev/pts/0
sudo chmod 666 /dev/pts/2
```
现在您已经创建了两个虚拟串口，可以在其间进行通信。您可以在终端中打开两个窗口，然后在一个终端中输入以下命令：
```bash
sudo cat /dev/pts/0
```
在另一个终端中输入以下命令：
```bash
sudo echo "Hello world" > /dev/pts/2
```
这将在 /dev/pts/2 中发送消息 "Hello world"，并在 /dev/pts/0 中接收到该消息。