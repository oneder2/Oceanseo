"""Exercise the second-device side against the fixed localhost QA fixture only."""
import json
import sys
import urllib.request

url = "http://127.0.0.1:4789/v1/vault"
headers = {"Authorization": "Bearer tideplan-local-test-token-not-for-production-123456", "Content-Type": "application/json"}
with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=5) as response:
    vault = json.load(response)
task = vault["records"]["task:11111111-1111-4111-8111-111111111111"]
mode = sys.argv[1]
if mode == "verify":
    assert task["completed_at"], "Phone completion not uploaded"
    assert task["notes"] == "手机同步笔记", "Phone notes not uploaded"
    print("PASS: second client sees phone completion and notes")
elif mode == "conflict":
    task["notes"] = "电脑同时修改的笔记"
    task["updated_at"] = "2026-09-29T20:00:00Z"
    data = json.dumps(dict(protocol=1, vaultId=vault["vaultId"], expectedRevision=vault["revision"], records=vault["records"])).encode()
    with urllib.request.urlopen(urllib.request.Request(url,data,headers,method="PUT"),timeout=5) as response:
        assert response.status == 200
    print("PASS: synthetic second-device edit submitted")
elif mode == "resolved":
    assert task["notes"] == "手机冲突时的笔记", "Conflict choice not propagated"
    print("PASS: explicit phone conflict choice propagated")
else:
    raise ValueError("Unknown QA step")
