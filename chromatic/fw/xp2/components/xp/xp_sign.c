// fw/xp2: "msign [pub|new]" - device-held ECDSA P-256 identity for the medic record.
//   msign      : sign SHA-256(Medic_DumpLog text) -> {"len","sha256","sig_der","pub"}
//   msign pub  : print the public key (uncompressed, 65 B hex) and its SHA-256 fingerprint
//   msign new  : generate a fresh key (overwrites NVS xpsign/sk) - used once to enrol the unit
// The private scalar is generated on the device from the hardware RNG and never printed.

#include "xp_priv.h"

#include "esp_console.h"
#include "esp_random.h"
#include "mbedtls/ecdh.h"
#include "mbedtls/ecdsa.h"
#include "mbedtls/gcm.h"
#include "mbedtls/ecp.h"
#include "mbedtls/sha256.h"
#include "nvs.h"

#include <stdlib.h>
#include <string.h>

#define SIGN_CAP 12288

static int rng(void *ctx, unsigned char *out, size_t n)
{
    (void)ctx;
    esp_fill_random(out, n);
    return 0;
}

static int load_key(mbedtls_ecp_keypair *kp, bool fresh, bool *created)
{
    uint8_t sk[32];
    size_t n = sizeof sk;
    nvs_handle_t h;
    *created = false;
    esp_err_t e = nvs_open("xpsign", NVS_READWRITE, &h);
    if (e != ESP_OK) return -1;
    if (!fresh && nvs_get_blob(h, "sk", sk, &n) == ESP_OK && n == 32 &&
        mbedtls_ecp_read_key(MBEDTLS_ECP_DP_SECP256R1, kp, sk, 32) == 0 &&
        mbedtls_ecp_keypair_calc_public(kp, rng, NULL) == 0)
    {
        nvs_close(h);
        memset(sk, 0, sizeof sk);
        return 0;
    }
    int rc = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, kp, rng, NULL);
    size_t olen = 0;
    if (rc == 0) rc = mbedtls_ecp_write_key_ext(kp, &olen, sk, sizeof sk);
    if (rc == 0 && olen == 32 && nvs_set_blob(h, "sk", sk, 32) == ESP_OK && nvs_commit(h) == ESP_OK) *created = true;
    else if (rc == 0) rc = -2;
    nvs_close(h);
    memset(sk, 0, sizeof sk);
    return rc;
}

static void print_pub(const mbedtls_ecp_keypair *kp)
{
    uint8_t pub[65], fp[32];
    size_t pl = 0;
    if (mbedtls_ecp_write_public_key(kp, MBEDTLS_ECP_PF_UNCOMPRESSED, &pl, pub, sizeof pub) != 0) pl = 0;
    mbedtls_sha256(pub, pl, fp, 0);
    printf("\"pub\":\"");
    xp_print_hexstr(pub, pl);
    printf("\",\"fp\":\"");
    xp_print_hexstr(fp, 8);
    printf("\"");
}

static int cmd_msign(int argc, char **argv)
{
    const bool want_pub = argc >= 2 && strcmp(argv[1], "pub") == 0;
    const bool fresh = argc >= 2 && strcmp(argv[1], "new") == 0;
    mbedtls_ecp_keypair kp;
    mbedtls_ecp_keypair_init(&kp);
    bool created = false;
    int rc = load_key(&kp, fresh, &created);
    if (rc != 0)
    {
        printf("{\"cmd\":\"msign\",\"error\":\"key %d\"}\n", rc);
        mbedtls_ecp_keypair_free(&kp);
        return 1;
    }
    if (want_pub || fresh)
    {
        printf("{\"cmd\":\"msign\",\"created\":%s,", created ? "true" : "false");
        print_pub(&kp);
        printf("}\n");
        mbedtls_ecp_keypair_free(&kp);
        return 0;
    }
    if (g_xp_hooks.dump_log == NULL)
    {
        printf("{\"cmd\":\"msign\",\"error\":\"no dump_log hook\"}\n");
        mbedtls_ecp_keypair_free(&kp);
        return 1;
    }
    char *txt = malloc(SIGN_CAP);
    if (txt == NULL)
    {
        printf("{\"cmd\":\"msign\",\"error\":\"no mem\"}\n");
        mbedtls_ecp_keypair_free(&kp);
        return 1;
    }
    int L = g_xp_hooks.dump_log(txt, SIGN_CAP);
    if (L < 0) L = 0;
    if (L > SIGN_CAP) L = SIGN_CAP;
    uint8_t hash[32], sig[MBEDTLS_ECDSA_MAX_LEN];
    size_t sl = 0;
    mbedtls_sha256((const unsigned char *)txt, (size_t)L, hash, 0);
    rc = mbedtls_ecdsa_write_signature(&kp, MBEDTLS_MD_SHA256, hash, 32, sig, sizeof sig, &sl, rng, NULL);
    printf("{\"cmd\":\"msign\",\"rc\":%d,\"created\":%s,\"len\":%d,\"sha256\":\"", rc, created ? "true" : "false", L);
    xp_print_hexstr(hash, 32);
    printf("\",\"sig_der\":\"");
    xp_print_hexstr(sig, rc == 0 ? sl : 0);
    printf("\",");
    print_pub(&kp);
    printf("}\n");
    free(txt);
    mbedtls_ecp_keypair_free(&kp);
    return rc == 0 ? 0 : 1;
}

// Sign SHA-256(msg) with the device key; DER signature into out. Returns its length, 0 on failure.
size_t XP_SignDer(const uint8_t *msg, size_t n, uint8_t *out, size_t cap)
{
    mbedtls_ecp_keypair kp;
    mbedtls_ecp_keypair_init(&kp);
    bool created = false;
    size_t sl = 0;
    uint8_t hash[32];
    if (load_key(&kp, false, &created) == 0)
    {
        mbedtls_sha256(msg, n, hash, 0);
        if (mbedtls_ecdsa_write_signature(&kp, MBEDTLS_MD_SHA256, hash, 32, out, cap, &sl, rng, NULL) != 0) sl = 0;
    }
    mbedtls_ecp_keypair_free(&kp);
    return sl;
}


// ---- mseal: encrypt the mlog text to an enrolled hospital public key (ECIES-style), then sign the sealed blob.
//   mseal enroll <hospital_pub_hex65>   store in NVS xpsign/hpub
//   mseal                              -> {"blob":hex( eph_pub65 | nonce12 | ct | tag16 ), "sig_der":..., "pub":...}
// key = SHA-256(ECDH(eph, hospital) || eph_pub65), AES-256-GCM, AAD = "CMXSEAL1" || device pub65.
static int cmd_mseal(int argc, char **argv)
{
    nvs_handle_t h;
    if (argc >= 3 && strcmp(argv[1], "enroll") == 0)
    {
        uint8_t hp[65];
        size_t n = 0;
        if (!xp_parse_hex_bytes(argv[2], hp, sizeof hp, &n) || n != 65 || hp[0] != 4)
        {
            printf("{\"cmd\":\"mseal\",\"error\":\"need 65-byte uncompressed P-256 point\"}\n");
            return 1;
        }
        if (nvs_open("xpsign", NVS_READWRITE, &h) != ESP_OK) return 1;
        esp_err_t e = nvs_set_blob(h, "hpub", hp, 65);
        if (e == ESP_OK) e = nvs_commit(h);
        nvs_close(h);
        uint8_t fp[32];
        mbedtls_sha256(hp, 65, fp, 0);
        printf("{\"cmd\":\"mseal\",\"enrolled\":%s,\"hospital_fp\":\"", e == ESP_OK ? "true" : "false");
        xp_print_hexstr(fp, 8);
        printf("\"}\n");
        return e == ESP_OK ? 0 : 1;
    }
    uint8_t hp[65];
    size_t hl = sizeof hp;
    if (nvs_open("xpsign", NVS_READONLY, &h) != ESP_OK || nvs_get_blob(h, "hpub", hp, &hl) != ESP_OK || hl != 65)
    {
        printf("{\"cmd\":\"mseal\",\"error\":\"no hospital key: mseal enroll <hex>\"}\n");
        return 1;
    }
    nvs_close(h);
    if (g_xp_hooks.dump_log == NULL) return 1;
    const size_t cap = 8192;
    uint8_t *blob = malloc(65 + 12 + cap + 16);
    char *txt = malloc(cap);
    if (blob == NULL || txt == NULL) { free(blob); free(txt); printf("{\"cmd\":\"mseal\",\"error\":\"no mem\"}\n"); return 1; }
    int L = g_xp_hooks.dump_log(txt, cap);
    if (L < 0) L = 0;

    mbedtls_ecp_group grp;
    mbedtls_mpi d, z;
    mbedtls_ecp_point Q, P;
    mbedtls_ecp_group_init(&grp); mbedtls_mpi_init(&d); mbedtls_mpi_init(&z);
    mbedtls_ecp_point_init(&Q); mbedtls_ecp_point_init(&P);
    uint8_t zb[32], kin[32 + 65], key[32], aad[8 + 65];
    size_t ol = 0;
    int rc = mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);
    if (rc == 0) rc = mbedtls_ecdh_gen_public(&grp, &d, &Q, rng, NULL);
    if (rc == 0) rc = mbedtls_ecp_point_read_binary(&grp, &P, hp, 65);
    if (rc == 0) rc = mbedtls_ecp_check_pubkey(&grp, &P);
    if (rc == 0) rc = mbedtls_ecdh_compute_shared(&grp, &z, &P, &d, rng, NULL);
    if (rc == 0) rc = mbedtls_mpi_write_binary(&z, zb, 32);
    if (rc == 0) rc = mbedtls_ecp_point_write_binary(&grp, &Q, MBEDTLS_ECP_PF_UNCOMPRESSED, &ol, blob, 65);
    mbedtls_ecp_keypair kp;
    mbedtls_ecp_keypair_init(&kp);
    bool created = false;
    if (rc == 0) rc = load_key(&kp, false, &created);
    size_t pl = 0;
    memcpy(aad, "CMXSEAL1", 8);
    if (rc == 0) rc = mbedtls_ecp_write_public_key(&kp, MBEDTLS_ECP_PF_UNCOMPRESSED, &pl, aad + 8, 65);
    if (rc == 0)
    {
        memcpy(kin, zb, 32);
        memcpy(kin + 32, blob, 65);
        mbedtls_sha256(kin, sizeof kin, key, 0);
        esp_fill_random(blob + 65, 12);
        mbedtls_gcm_context g;
        mbedtls_gcm_init(&g);
        rc = mbedtls_gcm_setkey(&g, MBEDTLS_CIPHER_ID_AES, key, 256);
        if (rc == 0) rc = mbedtls_gcm_crypt_and_tag(&g, MBEDTLS_GCM_ENCRYPT, (size_t)L, blob + 65, 12, aad, sizeof aad,
                                                    (const unsigned char *)txt, blob + 77, 16, blob + 77 + L);
        mbedtls_gcm_free(&g);
    }
    const size_t bl = 77 + (size_t)L + 16;
    uint8_t hash[32], sig[MBEDTLS_ECDSA_MAX_LEN];
    size_t sl = 0;
    if (rc == 0)
    {
        mbedtls_sha256(blob, bl, hash, 0);
        rc = mbedtls_ecdsa_write_signature(&kp, MBEDTLS_MD_SHA256, hash, 32, sig, sizeof sig, &sl, rng, NULL);
    }
    printf("{\"cmd\":\"mseal\",\"rc\":%d,\"plain_len\":%d,\"blob_len\":%u,\"blob\":\"", rc, L, (unsigned)bl);
    if (rc == 0) xp_print_hexstr(blob, bl);
    printf("\",\"sig_der\":\"");
    if (rc == 0) xp_print_hexstr(sig, sl);
    printf("\"}\n");
    memset(zb, 0, sizeof zb); memset(key, 0, sizeof key); memset(kin, 0, sizeof kin);
    memset(txt, 0, cap);
    mbedtls_ecp_keypair_free(&kp);
    mbedtls_ecp_group_free(&grp); mbedtls_mpi_free(&d); mbedtls_mpi_free(&z);
    mbedtls_ecp_point_free(&Q); mbedtls_ecp_point_free(&P);
    free(blob); free(txt);
    return rc == 0 ? 0 : 1;
}

void xp_register_sign_cmds(void)
{
    const esp_console_cmd_t c = {
        .command = "msign",
        .help = "xp2: msign [pub|new] - ECDSA P-256 (device key in NVS) over SHA-256 of the mlog text",
        .func = cmd_msign,
    };
    esp_console_cmd_register(&c);
    const esp_console_cmd_t m = {
        .command = "mseal",
        .help = "xp2: mseal enroll <hospital_pub_hex> | mseal - encrypt mlog to the hospital key (ECDH+AES-GCM), device-signed",
        .func = cmd_mseal,
    };
    esp_console_cmd_register(&m);
}
