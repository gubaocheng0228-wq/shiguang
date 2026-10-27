# 密钥目录（不提交）

构建 release 需要两把密钥，这里默认是空的：

| 文件 | 用途 | 怎么来 |
|---|---|---|
| shiguang.jks | 给 APK 签名（决定能不能覆盖安装） | keytool -genkeypair -keystore keystore/shiguang.jks -alias shiguang -keyalg RSA -keysize 2048 -validity 10950 |
| update-key.pem | 给更新清单签名（决定 App 认不认清单） | 
ode scripts/gen-update-key.js |

口令/别名在 pp/build.gradle 里改成你自己的。
两个文件都不要提交到仓库；丢了就发不了更新（shiguang.jks 丢了连覆盖安装都不行）。