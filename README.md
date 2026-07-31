# Local Share

Local Share sends files and text directly between devices on the same local
network. It does not require an account, a cloud service, or an internet
connection once the app is installed.

Local Share is available for Windows, Linux, and Android. It is an independent
project and does not implement the LocalSend protocol; both devices must be
running Local Share.

## What it does

- Finds other Local Share devices automatically over mDNS.
- Sends one or more files with transfer progress on both devices.
- Lets the receiving device accept or reject an incoming transfer.
- Sends short text messages between devices.
- Saves received files to the device's Downloads folder.
- Supports drag-and-drop on desktop and the Android system file picker.
- Shows completion notifications, including native Android notifications when
  the app is in the background.
- Lets you change the device name and network port.

## Download

Install the latest build from [GitHub Releases](https://github.com/ach-raf/localsend_rust/releases):

- Windows: installer or portable x86_64 ZIP
- Linux x86_64: AppImage, `.deb`, or `.rpm`
- Android: universal APK or an architecture-specific APK

On Android, use the universal APK if you do not know which architecture your
device uses.

## Using Local Share

1. Install and open Local Share on both devices.
2. Connect both devices to the same local network.
3. Wait for the other device to appear, then select it.
4. Choose files, drag files onto the device on desktop, or type a message.
5. Confirm the transfer on the receiving device. Received files are saved to
   Downloads.

If devices do not appear, make sure Local Share is open on both devices and
that the operating system or firewall allows local-network access. The default
transfer port is `3030` and can be changed in Settings.

## Network and privacy

Files and messages travel directly between devices over the local network;
Local Share does not upload them to an external server. Transfers use HTTP and
are not encrypted, so use the app only on networks and with devices you trust.
Incoming file transfers require approval from the receiving device.

## Demo videos

The two recordings show the same transfer from the sending PC and receiving
Android device.

| PC — sending | Android — receiving |
| :---: | :---: |
| [Watch the PC send a file](<screenshots/2026-07-31 19_41_31-Naruto_Shippuden-explorer.mp4>) | [Watch Android receive it](<screenshots/Screen_Recording_20260731_194230_Local Share.mp4>) |

## Screenshots

### Sending

| | |
| :---: | :---: |
| <img src="screenshots/2026-07-31%2019_45_21-Local_Share-local-share.png" alt="Local Share waiting to discover nearby devices" width="360" /><br><sub><b>Waiting for devices</b><br>Local Share listens for nearby peers.</sub> | <img src="screenshots/2026-07-31%2019_45_29-Local_Share-local-share.png" alt="Local Share showing a discovered Android peer" width="360" /><br><sub><b>Peer discovered</b><br>The Android device appears automatically.</sub> |
| <img src="screenshots/2026-07-31%2019_45_39-Local_Share-local-share.png" alt="Dragging a file onto a nearby peer in Local Share" width="360" /><br><sub><b>Drop to send</b><br>Drag a file directly onto the peer.</sub> | <img src="screenshots/2026-07-31%2019_45_46-Local_Share-local-share.png" alt="Local Share file selection panel for a nearby peer" width="360" /><br><sub><b>Choose files</b><br>Select one or more files for the chosen peer.</sub> |
| <img src="screenshots/2026-07-31%2019_45_52-Local_Share-local-share.png" alt="Local Share successful file sent notification" width="360" /><br><sub><b>Sent successfully</b><br>The sender gets immediate confirmation.</sub> | |

### Receiving

| | |
| :---: | :---: |
| <img src="screenshots/2026-07-31%2019_46_05-Local_Share-local-share.png" alt="Local Share incoming file transfer confirmation dialog" width="360" /><br><sub><b>Incoming request</b><br>The receiver can accept or reject the file.</sub> | <img src="screenshots/2026-07-31%2019_46_10-Local_Share-local-share.png" alt="Local Share file received notification" width="360" /><br><sub><b>File received</b><br>The completed transfer is ready to open.</sub> |

## Development

Build instructions, platform prerequisites, verification commands, architecture
notes, and release details are in [DEVELOPMENT.md](DEVELOPMENT.md). Android
signing is documented separately in [ANDROID_SIGNING.md](ANDROID_SIGNING.md).
