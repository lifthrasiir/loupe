#!/usr/bin/env python3
"""Offline channel pruning for Loupe's PP-OCR models.

Many channels of the shipped PP-OCR weights are dead: every weight producing
them is zero (or negligibly small), so the channel holds a per-channel
constant. Such channels can be removed from the graph entirely, folding their
constant contribution into the bias of each consuming convolution.

The pruned model uses the same manifest format and needs no engine changes:
only weight shapes/offsets and depthwise `group` attributes change.

How it works:

1. Constant propagation. Weights with |w| <= threshold count as zero, and a
   per-channel constant value is propagated through the spatial (NCHW) part
   of the graph.

2. Channel classes. Channels connected by per-channel ops (bias add,
   activations, BN, depthwise conv, pooling, resize, SE gating, residual add)
   or by Concat are the same channel and are pruned together. A class is
   frozen if it reaches the graph input/output or anything non-spatial (such
   as the reshape into the rec transformer).

3. A class is pruned when, at the input of every consuming convolution, it is
   constant and the consumer can absorb it: the value is zero, or the conv has
   no padding and feeds a bias Add or BN whose bias then takes the constant.

4. Every tensor keeps a multiple of 4 channels (and at least 4): the engine
   packs 4 channels per texel, so this costs nothing and keeps its shaders
   (notably Concat) on well-trodden paths.

With threshold 0 the transformation is exact up to f16 rounding of the
adjusted biases.

Usage: prune_model.py SRC_DIR OUT_DIR [--threshold T]
SRC_DIR must contain model_manifest.json, det_weights_f16.bin and
rec_weights_f16.bin. OUT_DIR receives the same three files.
"""

import argparse
import json
import math
import os
import sys

import numpy as np

PER_CHANNEL_UNARY = {'Relu', 'Erf', 'Sigmoid', 'HardSigmoid', 'Resize', 'MaxPool', 'AveragePool', 'ReduceMean',
                     'BatchNormalization'}
PER_CHANNEL_BINARY = {'Add', 'Mul', 'Sub', 'Div'}


class UnionFind:
    def __init__(self, n):
        self.p = np.arange(n)

    def find(self, x):
        p = self.p
        r = x
        while p[r] != r:
            r = p[r]
        while p[x] != r:
            p[x], x = r, p[x]
        return r

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[a] = b


def has_padding(attrs, kh, kw):
    if attrs.get('auto_pad') in ('SAME_UPPER', 'SAME_LOWER'):
        return kh > 1 or kw > 1
    return any(attrs.get('pads', [0, 0, 0, 0]))


def tensor_inputs(o):
    return [i['name'] for i in o['inputs'] if i['type'] == 'tensor']


def prune_model(g, raw, thr, log):
    """g: manifest entry with 'ops' and 'weights' (ops are updated in place);
    raw: uint16 array of f16 weights. Returns (new weights meta, new u16 array)."""
    ops, wmeta = g['ops'], g['weights']
    f32 = raw.view(np.float16).astype(np.float32)
    W = {n: f32[v['offset'] // 4: v['offset'] // 4 + v['size']].reshape(v['shape']) for n, v in wmeta.items()}
    U = {n: raw[v['offset'] // 4: v['offset'] // 4 + v['size']].reshape(v['shape']) for n, v in wmeta.items()}

    consumers, wrefs = {}, {}
    for i, o in enumerate(ops):
        for inp in o['inputs']:
            if inp['type'] == 'tensor':
                consumers.setdefault(inp['name'], []).append(i)
            elif inp['type'] == 'weight':
                wrefs.setdefault(inp['name'], []).append(i)

    # ---- pass 1: channel counts, constants, channel links
    C = {'x': 3}                       # spatial tensors only
    const = {'x': np.full(3, np.nan)}  # per-channel constant value, NaN = varying
    links = []                         # (tensor a, offset a, tensor b, offset b, count): channels shared
    frozen = {'x'}                     # tensors whose channels must all be kept

    for o in ops:
        op, out, a = o['op'], o['outputs'][0], o.get('attrs', {})
        ts = tensor_inputs(o)
        sp = [t for t in ts if t in C]
        if not ts or len(sp) != len(ts):
            frozen.update(sp)          # non-spatial (or mixed) op
            continue
        x = sp[0]
        cx = const[x]
        if op == 'Conv':
            w = W[o['inputs'][1]['name']]
            O, Ig, kh, kw = w.shape
            grp = a.get('group', 1)
            pad = has_padding(a, kh, kw)
            nzw = np.abs(w) > thr
            C[out] = O
            v = np.full(O, np.nan)
            if grp == 1:
                cfold = ~np.isnan(cx) & ((cx == 0) | (not pad))
                live = (nzw.any(axis=(2, 3)) & ~cfold[None, :]).any(axis=1)
                wsum = np.where(nzw, w, 0).sum(axis=(2, 3))
                v[~live] = (wsum[~live] * np.where(cfold, np.nan_to_num(cx), 0)[None, :]).sum(axis=1)
            elif grp == O == C[x] and Ig == 1:
                links.append((x, 0, out, 0, O))
                v[~nzw.reshape(O, -1).any(axis=1) | (cx == 0)] = 0
                if not pad:
                    ok = ~np.isnan(cx)
                    v[ok] = cx[ok] * np.where(nzw, w, 0).reshape(O, -1).sum(axis=1)[ok]
            else:
                frozen.update([x, out])
            const[out] = v
        elif op == 'ConvTranspose':
            w = W[o['inputs'][1]['name']]
            I, O = w.shape[:2]
            C[out] = O
            live = ((np.abs(w) > thr).any(axis=(2, 3)) & ~(cx == 0)[:, None]).any(axis=0)
            const[out] = np.where(live, np.nan, 0.0)
        elif op in PER_CHANNEL_UNARY or op in PER_CHANNEL_BINARY:
            if op == 'ReduceMean' and list(a.get('axes', [])) != [2, 3]:
                frozen.add(x)
                continue
            n = C[x]
            C[out] = n
            for t in sp:
                links.append((t, 0, out, 0, n))
            v = cx.copy()
            if op == 'Relu':
                v = np.maximum(v, 0)
            elif op == 'Sigmoid':
                v = 1 / (1 + np.exp(-v))
            elif op == 'HardSigmoid':
                v = np.clip(a.get('alpha', 0.2) * v + a.get('beta', 0.5), 0, 1)
            elif op == 'Erf':
                v = np.array([math.erf(t) if not np.isnan(t) else np.nan for t in v])
            elif op == 'BatchNormalization':
                gm, bt, mn, vr = (W[o['inputs'][k]['name']].reshape(-1) for k in range(1, 5))
                v = (v - mn) / np.sqrt(vr + a.get('epsilon', 1e-5)) * gm + bt
            elif op in PER_CHANNEL_BINARY:
                other = o['inputs'][1]
                if other['type'] == 'tensor':
                    ov = const[sp[1]] if len(sp) > 1 else cx
                elif other['type'] == 'weight':
                    ov = W[other['name']].reshape(-1)
                    if ov.size not in (1, n):
                        frozen.update([x, out])
                        continue
                    ov = np.broadcast_to(ov, (n,))
                else:
                    ov = np.full(n, float(np.asarray(other['value']).reshape(-1)[0]))
                with np.errstate(invalid='ignore'):
                    if op == 'Add':
                        v = v + ov
                    elif op == 'Sub':
                        v = v - ov
                    elif op == 'Div':
                        v = v / ov
                    else:
                        v = v * ov
                        v[(cx == 0) | (ov == 0)] = 0
            const[out] = v
        elif op == 'Concat' and a.get('axis') == 1:
            off = 0
            for t in sp:
                links.append((t, 0, out, off, C[t]))
                off += C[t]
            C[out] = off
            const[out] = np.concatenate([const[t] for t in sp])
        else:
            frozen.update(sp)

    for t in C:
        if t not in consumers:
            frozen.add(t)              # graph outputs

    # ---- pass 2: channel classes
    base, n_nodes = {}, 0
    for t, n in C.items():
        base[t] = n_nodes
        n_nodes += n
    uf = UnionFind(n_nodes)
    for ta, oa, tb, ob, n in links:
        for c in range(n):
            uf.union(base[ta] + oa + c, base[tb] + ob + c)

    def classes(t):
        return np.array([uf.find(base[t] + c) for c in range(C[t])], dtype=np.int64)

    blocked = np.zeros(n_nodes, bool)  # indexed by class root
    for t in frozen:
        blocked[classes(t)] = True

    def bias_target(conv_out):
        """The single op that can absorb a per-output-channel shift: (op index, 'add'|'bn')."""
        cs = consumers.get(conv_out, [])
        if len(cs) != 1:
            return None
        o = ops[cs[0]]
        if o['op'] == 'Add' and o['inputs'][1]['type'] == 'weight' and len(wrefs[o['inputs'][1]['name']]) == 1:
            return cs[0], 'add'
        if o['op'] == 'BatchNormalization' and len(wrefs[o['inputs'][3]['name']]) == 1:
            return cs[0], 'bn'
        return None

    convs = [i for i, o in enumerate(ops)
             if o['op'] == 'ConvTranspose' or (o['op'] == 'Conv' and o.get('attrs', {}).get('group', 1) == 1)]
    for i in convs:
        o = ops[i]
        x = o['inputs'][0]['name']
        if x not in C:
            continue
        cx = const[x]
        ok = cx == 0
        if o['op'] == 'Conv':
            kh, kw = W[o['inputs'][1]['name']].shape[2:]
            if not has_padding(o.get('attrs', {}), kh, kw) and bias_target(o['outputs'][0]) is not None:
                ok = ~np.isnan(cx)
        blocked[classes(x)[~ok]] = True

    # ---- pass 3: tensor masks, rounded so every tensor keeps a multiple of 4 channels
    cls = {t: classes(t) for t in C}
    while True:
        changed = False
        for t, n in C.items():
            prunable = ~blocked[cls[t]]
            keep = n - int(prunable.sum())
            want = max(4, -(-keep // 4) * 4) if n % 4 == 0 else n
            if want > keep:
                extra = np.nonzero(prunable)[0][:want - keep]
                blocked[cls[t][extra]] = True
                changed = True
        if not changed:
            break
    mask = {t: ~blocked[cls[t]] for t in C}  # True = removed

    # ---- pass 4: rewrite weights
    newW, newU = dict(W), dict(U)
    done = set()

    def take(name, axis, keep):
        if (name, axis) in done:
            assert len(wrefs[name]) > 1, f'{name} pruned twice along axis {axis}'
            return
        done.add((name, axis))
        newW[name] = np.compress(keep, newW[name], axis=axis)
        newU[name] = np.compress(keep, newU[name], axis=axis)

    for i, o in enumerate(ops):
        op, out = o['op'], o['outputs'][0]
        if out not in C:
            continue
        if op in ('Conv', 'ConvTranspose'):
            wn = o['inputs'][1]['name']
            x = o['inputs'][0]['name']
            mi, mo = mask[x], mask[out]
            if op == 'Conv' and o.get('attrs', {}).get('group', 1) != 1:
                if mo.any():
                    assert (mi == mo).all()
                    take(wn, 0, ~mo)
                    o['attrs']['group'] = int((~mo).sum())
                continue
            in_ax, out_ax = (1, 0) if op == 'Conv' else (0, 1)
            if mi.any():
                fold = np.where(mi & (const[x] != 0), np.nan_to_num(const[x]), 0)
                if fold.any():
                    # use the full original weights; the bias target comes later in op order,
                    # so it still has all of this conv's output channels
                    d = (W[wn].astype(np.float64).sum(axis=(2, 3)) * fold[None, :]).sum(axis=1)
                    j, kind = bias_target(out)
                    bn = ops[j]['inputs'][1 if kind == 'add' else 3]['name']
                    cur = newW[bn].astype(np.float64)
                    assert cur.size == d.size
                    cur = cur + d.reshape(cur.shape) if kind == 'add' else cur - d.reshape(cur.shape)
                    newW[bn] = cur.astype(np.float32)
                    newU[bn] = cur.astype(np.float16).view(np.uint16)
                take(wn, in_ax, ~mi)
            if mo.any():
                take(wn, out_ax, ~mo)
        elif mask[out].any():
            m = mask[out]
            for inp in o['inputs']:
                if inp['type'] == 'weight':
                    assert W[inp['name']].size in (1, m.size), f'unexpected weight {inp["name"]} in op {i}'
                    if W[inp['name']].size == m.size:
                        take(inp['name'], 0, ~m)

    removed = sum(int(m.sum()) for m in mask.values())
    total = sum(C.values())
    log(f'  removed {removed} of {total} tensor channels')

    # ---- serialize (keep original order, align every tensor to 4 elements)
    meta, chunks, off = {}, [], 0
    for name in wmeta:
        u = np.ascontiguousarray(newU[name]).reshape(-1)
        pad = (-u.size) % 4
        meta[name] = {'offset': off * 4, 'shape': list(newU[name].shape), 'size': int(u.size)}
        chunks.append(u)
        if pad:
            chunks.append(np.zeros(pad, np.uint16))
        off += u.size + pad
    return meta, np.concatenate(chunks)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--threshold', type=float, default=0.0,
                    help='weights with |w| <= T count as zero for liveness (default 0: exact)')
    args = ap.parse_args()
    with open(os.path.join(args.src, 'model_manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    os.makedirs(args.out, exist_ok=True)
    for k in ('det', 'rec'):
        raw = np.fromfile(os.path.join(args.src, f'{k}_weights_f16.bin'), dtype='<u2')
        print(f'{k}: {raw.size * 2 / 1e6:.1f} MB')
        meta, u16 = prune_model(manifest[k], raw, args.threshold, print)
        manifest[k]['weights'] = meta
        u16.astype('<u2').tofile(os.path.join(args.out, f'{k}_weights_f16.bin'))
        print(f'  -> {u16.size * 2 / 1e6:.1f} MB')
    with open(os.path.join(args.out, 'model_manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False)


if __name__ == '__main__':
    sys.exit(main())
