package com.shiguang.app;

/**
 * 更新清单的验签公钥。私钥在 keystore/update-key.pem，只在你电脑上。
 * 换密钥 = 所有已安装的 App 都无法再接受新的更新清单（除非重发 APK）。
 */
final class UpdateKey {
    private UpdateKey() { }

    static final String PUBKEY_B64 =
            "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA31rco7UzYGoyOwf+sLU+l3cI5B9SyGtaltGNwnz8e+8E7zIbbpFUcBHp6tBpysVpR6ARjucZ0be4Bdt9y/F2hrqeymwDboxoTWhJ7gdx7ppoKxe/i90gDeXK7MAlvkcG/wr1+eKfnxNxiCEU50M0GV8pqCGexNMnoUyuANtGbnVtULeRkaZl+SrALYUKV4th5Jz3ist8YvCeALDwJP1v2kF5JRqY2h9zPXbAxBlcbjte9UdmrbWUjC8hjSio72uQJVft5EJeyl+Fv6K/w8vk/5M4Mo3Pjfh7sA24cM9SLlirays8L/knIs+XKsP4ofeZD6et+z0GV1DujsZhjjn+xQIDAQAB";
}
