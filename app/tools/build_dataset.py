"""Gom các file mẫu huấn luyện (tải từ trang Đếm: mau_huan_luyen_*.json) thành bộ dữ liệu ảnh để huấn luyện.

    python -m app.tools.build_dataset data\\train\\*.json --out data\\dataset

Kết quả:
    data/dataset/
      bo_vao/<id>_f0.jpg, _f1.jpg, _f2.jpg     (mẫu dương: kiện đi vào bao, 3 khung -0,4/0/+0,4s)
      khong_kien/...                             (mẫu âm: không có kiện)
      sai/...                                    (mẫu âm khó: khung tool ghép sai)
      manifest.csv                               (id, nhãn, phiếu TO, camera, video, thời điểm, tập train/val)
Mẫu 'khong_ro' bị bỏ. Chia train/val THEO PHIẾU TO (không để cùng một bao lọt vào cả hai tập).
"""
from __future__ import annotations

import argparse
import base64
import csv
import glob
import hashlib
import json
from pathlib import Path

USE = {"bo_vao", "khong_kien", "sai"}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", default="data/dataset")
    ap.add_argument("--val-frac", type=float, default=0.2)
    a = ap.parse_args(argv)
    out = Path(a.out)
    files = [f for pat in a.inputs for f in glob.glob(pat)]
    rows, seen = [], set()
    for f in files:
        d = json.load(open(f, encoding="utf-8"))
        if d.get("format") != "dem-kien-train/1":
            print("bỏ qua (không đúng định dạng):", f)
            continue
        for s in d["samples"]:
            if s["label"] not in USE or s["id"] in seen:
                continue
            seen.add(s["id"])
            bag = s.get("bag") or "KHONG_RO"
            # chia theo bao: băm mã bao -> ổn định giữa các lần chạy
            split = "val" if int(hashlib.md5(bag.encode()).hexdigest(), 16) % 1000 < a.val_frac * 1000 else "train"
            d_lab = out / s["label"]
            d_lab.mkdir(parents=True, exist_ok=True)
            for i, uri in enumerate(s["frames"]):
                (d_lab / f"{s['id']}_f{i}.jpg").write_bytes(base64.b64decode(uri.split(",", 1)[1]))
            rows.append(dict(id=s["id"], label=s["label"], bag=bag, camera=s.get("camera", ""), video=s.get("videoFile", ""),
                             t=s.get("videoTimeS"), corrected=s.get("corrected", False), split=split))
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["id", "label", "bag", "camera", "video", "t", "corrected", "split"])
        w.writeheader(); w.writerows(rows)
    cnt = {}
    for r in rows:
        cnt[(r["label"], r["split"])] = cnt.get((r["label"], r["split"]), 0) + 1
    print(f"{len(rows)} mẫu từ {len(files)} file ->", out)
    for k in sorted(cnt):
        print("  ", k, cnt[k])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
