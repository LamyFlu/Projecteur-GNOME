# Projecteur GNOME

在 **Ubuntu 26.04／GNOME Shell 50／Wayland** 上，使用 **Logitech Spotlight**
控制可調整的螢幕雷射紅點。

[English](README.md) · [開發說明](gnome/README.md) ·
[原始 Projecteur](https://github.com/gbin/Projecteur)

本專案是 Projecteur 的 GNOME 相容版本，沿用原專案的簡報器處理程式，並加入
GNOME Shell 擴充功能。GNOME 版本可獨立建置，不需安裝 Plasma。
目前已在 GNOME 50.1、Logitech Spotlight USB 接收器（`046d:c53e`）及
OnlyOffice 全螢幕簡報環境完成本機測試。

<img src="doc/gnome-spotlight-demo.png" alt="使用 Logitech Spotlight 控制筆電畫面上的紫色雷射指標" width="480">

畫面中的紫色光點為本專案的指標；紅色箭頭為這張示範照片的標註。

## 功能

- 使用簡報器移動控制雷射紅點。
- 調整顏色與大小，邊框及光暈會跟隨所選顏色。
- 紅點顯示時隱藏滑鼠箭頭，結束後自動恢復。
- 調整停止移動後的停留時間：0.1–30 秒，預設 3 秒。
- 保留上一頁／下一頁操作，支援全螢幕畫面覆蓋。
- 設定自動儲存並立即套用。
- 中文語系（包含簡體中文系統）顯示繁體中文，其他語系顯示英文。
  GTK 內建對話框的系統按鈕使用系統提供的翻譯。

## 安裝

下載並解壓縮本專案的原始碼 ZIP，在解壓縮後的資料夾開啟終端機，執行：

```sh
./install.sh
```

請以一般桌面使用者執行，不要在指令前加 `sudo`。安裝程式會處理缺少的建置套件、
編譯、裝置權限、使用者服務及擴充功能啟用。安裝缺少的套件或裝置權限時，
可能需要輸入管理員密碼；程式與擴充功能會安裝到你的使用者帳號。

**已包含 GNOME 擴充功能**，不需要再到 GNOME Extensions 網站另外安裝。
背景服務負責讀取簡報器，擴充功能負責顯示紅點並提供設定視窗。

**重新連接簡報器，再登出並登入。** 擴充功能會自動啟用，不需要再執行第二個
安裝指令。更新也使用同一個指令，既有設定會保留。

如果已由其他方式安裝套件及裝置權限，可使用：

```sh
./install.sh --no-system-changes
```

自動安裝支援 Ubuntu 26.04／GNOME 50／Wayland；其他發行版與 GNOME 版本尚未驗證。

## 設定與操作

1. 安裝完成並重新登入後，在應用程式搜尋「**擴充功能**」（Extensions）。
2. 找到「**Projecteur Pointer for Ubuntu 26.04**」，確認開關已啟用。
3. 按該項目的設定按鈕，開啟紅點設定。

若系統沒有安裝「擴充功能」管理程式，或希望直接開啟設定，
可在終端機執行以下指令（不需要額外安裝管理程式）：

```sh
gnome-extensions prefs projecteur-pointer-ubuntu26@projecteur.github.io
```

本機設定視窗（繁體中文）：

<img src="doc/gnome-pointer-preferences.zh-TW.png" alt="Projecteur 設定視窗：顏色、大小、隱藏滑鼠游標與停留秒數" width="640">

點擊色塊選擇顏色；用 `−`／`＋` 調整大小與停留秒數，使用開關控制游標隱藏。
設定會自動儲存並立即套用。圖片中的紫色、30 像素及 3 秒是示範設定，可自行調整。

可調整顏色、直徑（6–96 邏輯像素）、是否隱藏滑鼠箭頭，以及停止移動後保留紅點
的秒數。按住 Spotlight 指示鍵並移動簡報器，即可控制紅點。

停留時間從**最後一次移動**開始計算，因為此裝置處理方式無法可靠取得指示鍵的
放開事件。因此，即使持續按住按鍵，只要停止移動也會開始計時。
紅點顯示期間會暫停全螢幕 direct scanout，消失後會恢復。

## 使用 AI 助手協助配置

本專案提供 [AGENTS.md](AGENTS.md)，包含 AI 助手可遵循的安裝、設定、除錯與
驗證指示。若你的 AI 助手能存取這台 Linux 電腦，可複製以下提示詞：

> 請先閱讀這個專案的 README.zh-TW.md 與 AGENTS.md，確認我的系統是否為
> Ubuntu 26.04、GNOME 50 與 Wayland，再協助我安裝及設定 Projecteur GNOME，
> 搭配 Logitech Spotlight 使用。請保留既有設定，說明需要的管理員權限，
> 不要自動登出或重新開機。等我重新登入後，檢查服務與擴充功能狀態，再帶我
> 測試紅點、游標隱藏、全螢幕簡報及上一頁／下一頁操作。

只有聊天功能的 AI 可以提供操作指引；實際安裝需要它能存取電腦。
管理員密碼只需在 Ubuntu 正常的密碼提示中輸入。

## 移除

```sh
./uninstall.sh
```

會移除使用者服務、程式與擴充功能。已儲存的偏好設定及系統 udev 權限規則會保留。

## 除錯

```sh
gnome-extensions info projecteur-pointer-ubuntu26@projecteur.github.io
systemctl --user status projecteur-gnome-daemon.service
journalctl --user -b -u projecteur-gnome-daemon.service --no-pager
```

更新後若仍看到舊版功能，請登出再登入，以重新載入 GNOME 擴充程式。
無法偵測簡報器時，請重新連接裝置並查看服務紀錄。
更多建置及測試指令請見 [gnome/README.md](gnome/README.md)。

## 原專案與授權

本專案以 [Projecteur](https://github.com/gbin/Projecteur) 為基礎，原作者為
Jahn Fuchs，上游由 Guillaume Binet 與貢獻者維護。本相容版本新增 GNOME daemon、
畫面覆蓋、指標設定及本機安裝流程，為獨立的社群改作。

[LICENSE.md](LICENSE.md) 保留 MIT 授權及原作者版權聲明。
原本的 KDE 實作仍保留於原始碼中；建置 KDE 版本請參考上游文件。
