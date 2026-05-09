// PhaserAnimExporter.cs
//
// Drop the containing `Editor/` folder into any Unity 6 project under `Assets/`
// to add a `Tools → Phaser Anim Exporter` menu item.
//
// Walks an AnimationClip's curves, emits a JSON timeline + one PNG per unique
// referenced sprite. Pair the PNGs with TexturePacker (or any atlas tool that
// outputs Phaser-3 JSON) to get an atlas the runtime player can consume.
//
// Companion docs: unity/SPEC.md, unity/EXPORT_GUIDE.md.

using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

public class PhaserAnimExporter : EditorWindow
{
    GameObject root;
    AnimationClip clip;
    string outputFolder = "";

    [MenuItem("Tools/Phaser Anim Exporter")]
    static void Open() => GetWindow<PhaserAnimExporter>("Phaser Anim Exporter");

    void OnGUI()
    {
        EditorGUILayout.LabelField("Source", EditorStyles.boldLabel);
        root = (GameObject)EditorGUILayout.ObjectField(
            new GUIContent("Rig root", "Root GameObject of the layered rig. Curve paths are resolved relative to this transform."),
            root, typeof(GameObject), true);
        clip = (AnimationClip)EditorGUILayout.ObjectField(
            new GUIContent("Animation clip", "Clip whose curves will be exported."),
            clip, typeof(AnimationClip), false);

        EditorGUILayout.Space();
        EditorGUILayout.LabelField("Output", EditorStyles.boldLabel);
        EditorGUILayout.BeginHorizontal();
        EditorGUILayout.TextField("Folder", outputFolder);
        if (GUILayout.Button("Browse", GUILayout.Width(72)))
        {
            var sel = EditorUtility.OpenFolderPanel("Choose output folder", outputFolder, "");
            if (!string.IsNullOrEmpty(sel)) outputFolder = sel;
        }
        EditorGUILayout.EndHorizontal();

        EditorGUILayout.Space();
        GUI.enabled = root != null && clip != null && !string.IsNullOrEmpty(outputFolder);
        if (GUILayout.Button("Export", GUILayout.Height(28))) Export();
        GUI.enabled = true;

        EditorGUILayout.Space();
        EditorGUILayout.HelpBox(
            "After export: run TexturePacker on <output>/sprites to produce atlas.png + atlas.json (Phaser 3 format), then drop animation.json + the atlas alongside in your web app. See EXPORT_GUIDE.md.",
            MessageType.Info);
    }

    // ---------- export ----------

    void Export()
    {
        Directory.CreateDirectory(outputFolder);
        var spritesDir = Path.Combine(outputFolder, "sprites");
        Directory.CreateDirectory(spritesDir);

        // layerName -> dict of trackName -> list of (time, value) for floats; spriteFrame stored separately
        var floatTracks = new Dictionary<string, Dictionary<string, List<KeyValuePair<float, float>>>>();
        var spriteTracks = new Dictionary<string, List<KeyValuePair<float, string>>>();
        var uniqueSprites = new Dictionary<string, Sprite>();

        // ---- float curves: localPosition, localEulerAngles, localScale ----
        // EditorCurveBinding.propertyName uses Unity's serialized form, e.g. "m_LocalPosition.x".
        // We map a small whitelist; everything else is silently skipped (and logged).
        var skipped = new HashSet<string>();
        foreach (var b in AnimationUtility.GetCurveBindings(clip))
        {
            var trackName = MapFloatProperty(b.propertyName, b.type);
            if (trackName == null)
            {
                skipped.Add(b.type.Name + "." + b.propertyName);
                continue;
            }
            var curve = AnimationUtility.GetEditorCurve(clip, b);
            if (curve == null) continue;

            var perLayer = floatTracks.TryGetValue(b.path, out var d) ? d
                : (floatTracks[b.path] = new Dictionary<string, List<KeyValuePair<float, float>>>());
            var keys = perLayer.TryGetValue(trackName, out var l) ? l
                : (perLayer[trackName] = new List<KeyValuePair<float, float>>());

            // Preserve the clip's keyframe times verbatim — no resampling. Phaser-side
            // playback does linear interpolation between adjacent keys.
            foreach (var k in curve.keys)
                keys.Add(new KeyValuePair<float, float>(k.time, k.value));
        }

        // ---- object reference curves: SpriteRenderer.m_Sprite ----
        foreach (var b in AnimationUtility.GetObjectReferenceCurveBindings(clip))
        {
            if (b.type != typeof(SpriteRenderer) || b.propertyName != "m_Sprite")
            {
                skipped.Add(b.type.Name + "." + b.propertyName);
                continue;
            }
            var keyframes = AnimationUtility.GetObjectReferenceCurve(clip, b);
            if (keyframes == null) continue;

            var list = spriteTracks.TryGetValue(b.path, out var l) ? l
                : (spriteTracks[b.path] = new List<KeyValuePair<float, string>>());

            foreach (var k in keyframes)
            {
                var sprite = k.value as Sprite;
                if (sprite == null) continue;
                if (!uniqueSprites.ContainsKey(sprite.name)) uniqueSprites[sprite.name] = sprite;
                list.Add(new KeyValuePair<float, string>(k.time, sprite.name));
            }
        }

        // ---- write sprite PNGs ----
        long totalAtlasInputBytes = 0;
        foreach (var kv in uniqueSprites)
        {
            var bytes = SpriteToPng(kv.Value);
            var path = Path.Combine(spritesDir, kv.Key + ".png");
            File.WriteAllBytes(path, bytes);
            totalAtlasInputBytes += bytes.Length;
        }

        // ---- collect layer metadata (depth, defaultFrame) from the live rig ----
        var layerOrder = new List<string>();
        layerOrder.AddRange(floatTracks.Keys);
        foreach (var k in spriteTracks.Keys) if (!layerOrder.Contains(k)) layerOrder.Add(k);
        layerOrder.Sort((a, b) => SortingDepth(a).CompareTo(SortingDepth(b)));

        // ---- write animation.json ----
        var json = BuildJson(layerOrder, floatTracks, spriteTracks);
        var jsonPath = Path.Combine(outputFolder, "animation.json");
        File.WriteAllText(jsonPath, json);

        // ---- summary ----
        var sb = new StringBuilder();
        sb.AppendLine($"[PhaserAnimExporter] Exported '{clip.name}' to {outputFolder}");
        sb.AppendLine($"  layers:        {layerOrder.Count}");
        sb.AppendLine($"  unique sprites:{uniqueSprites.Count}");
        sb.AppendLine($"  animation.json:{new FileInfo(jsonPath).Length} bytes");
        sb.AppendLine($"  atlas inputs:  {totalAtlasInputBytes} bytes (sum of per-sprite PNGs in sprites/)");
        if (skipped.Count > 0)
            sb.AppendLine($"  skipped properties (unsupported): {string.Join(", ", skipped)}");
        Debug.Log(sb.ToString());
        EditorUtility.RevealInFinder(jsonPath);
    }

    // ---------- helpers ----------

    // Unity's animation system serializes properties under stable names.
    // Whitelist the ones we know how to translate.
    static string MapFloatProperty(string prop, System.Type type)
    {
        if (type != typeof(Transform)) return null;
        switch (prop)
        {
            case "m_LocalPosition.x": return "x";
            case "m_LocalPosition.y": return "y";
            // Z translation is ignored — Phaser playback is 2D.
            case "localEulerAnglesRaw.z": return "rotation";
            case "localEulerAngles.z":    return "rotation";
            case "m_LocalScale.x":        return "scaleX";
            case "m_LocalScale.y":        return "scaleY";
            default: return null;
        }
    }

    int SortingDepth(string transformPath)
    {
        if (root == null) return 0;
        var t = root.transform.Find(transformPath);
        if (t == null) return 0;
        var sr = t.GetComponent<SpriteRenderer>();
        return sr != null ? sr.sortingOrder : 0;
    }

    string DefaultFrameName(string transformPath)
    {
        if (root == null) return "";
        var t = root.transform.Find(transformPath);
        if (t == null) return "";
        var sr = t.GetComponent<SpriteRenderer>();
        return sr != null && sr.sprite != null ? sr.sprite.name : "";
    }

    // Pulls the source pixels for a sprite — works whether the sprite is the
    // whole texture or a sub-rect inside an atlas slice. Bypasses
    // TextureImporter's read/write toggle by blitting through a RenderTexture.
    static byte[] SpriteToPng(Sprite sprite)
    {
        var rect = sprite.rect;
        var src = sprite.texture;
        var w = Mathf.RoundToInt(rect.width);
        var h = Mathf.RoundToInt(rect.height);
        var rt = RenderTexture.GetTemporary(w, h, 0, RenderTextureFormat.ARGB32);
        var prev = RenderTexture.active;
        try
        {
            // Scale/offset map [0,1] uv into the sprite sub-rect of the source texture.
            var scale = new Vector2(rect.width / src.width, rect.height / src.height);
            var offset = new Vector2(rect.x / src.width, rect.y / src.height);
            Graphics.Blit(src, rt, scale, offset);

            RenderTexture.active = rt;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
            tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            tex.Apply();
            var bytes = tex.EncodeToPNG();
            Object.DestroyImmediate(tex);
            return bytes;
        }
        finally
        {
            RenderTexture.active = prev;
            RenderTexture.ReleaseTemporary(rt);
        }
    }

    // Hand-rolled JSON writer — avoids dragging in a serialization dep.
    string BuildJson(
        List<string> layers,
        Dictionary<string, Dictionary<string, List<KeyValuePair<float, float>>>> floatTracks,
        Dictionary<string, List<KeyValuePair<float, string>>> spriteTracks)
    {
        var sb = new StringBuilder();
        var inv = CultureInfo.InvariantCulture;
        sb.Append("{\n");
        sb.AppendFormat(inv, "  \"name\": \"{0}\",\n", Esc(clip.name));
        sb.AppendFormat(inv, "  \"duration\": {0},\n", clip.length.ToString("0.######", inv));
        sb.AppendFormat(inv, "  \"frameRate\": {0},\n", clip.frameRate.ToString("0.######", inv));
        sb.Append("  \"atlas\": \"atlas.json\",\n");

        // layers
        sb.Append("  \"layers\": [\n");
        for (int i = 0; i < layers.Count; i++)
        {
            var name = layers[i];
            sb.Append("    { ");
            sb.AppendFormat(inv, "\"name\": \"{0}\", ", Esc(name));
            sb.AppendFormat(inv, "\"defaultFrame\": \"{0}\", ", Esc(DefaultFrameName(name)));
            sb.AppendFormat(inv, "\"depth\": {0}", SortingDepth(name));
            sb.Append(" }");
            if (i < layers.Count - 1) sb.Append(",");
            sb.Append("\n");
        }
        sb.Append("  ],\n");

        // tracks
        sb.Append("  \"tracks\": {\n");
        for (int i = 0; i < layers.Count; i++)
        {
            var name = layers[i];
            sb.AppendFormat(inv, "    \"{0}\": {{\n", Esc(name));

            var trackLines = new List<string>();
            if (floatTracks.TryGetValue(name, out var per))
            {
                foreach (var t in per)
                    trackLines.Add(WriteFloatTrack(t.Key, t.Value));
            }
            if (spriteTracks.TryGetValue(name, out var sl))
                trackLines.Add(WriteSpriteTrack(sl));

            for (int j = 0; j < trackLines.Count; j++)
            {
                sb.Append("      ");
                sb.Append(trackLines[j]);
                if (j < trackLines.Count - 1) sb.Append(",");
                sb.Append("\n");
            }
            sb.Append("    }");
            if (i < layers.Count - 1) sb.Append(",");
            sb.Append("\n");
        }
        sb.Append("  }\n}\n");
        return sb.ToString();
    }

    static string WriteFloatTrack(string name, List<KeyValuePair<float, float>> keys)
    {
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.AppendFormat(inv, "\"{0}\": [", name);
        for (int i = 0; i < keys.Count; i++)
        {
            sb.AppendFormat(inv, "[{0}, {1}]",
                keys[i].Key.ToString("0.######", inv),
                keys[i].Value.ToString("0.######", inv));
            if (i < keys.Count - 1) sb.Append(", ");
        }
        sb.Append("]");
        return sb.ToString();
    }

    static string WriteSpriteTrack(List<KeyValuePair<float, string>> keys)
    {
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.Append("\"spriteFrame\": [");
        for (int i = 0; i < keys.Count; i++)
        {
            sb.AppendFormat(inv, "[{0}, \"{1}\"]",
                keys[i].Key.ToString("0.######", inv),
                Esc(keys[i].Value));
            if (i < keys.Count - 1) sb.Append(", ");
        }
        sb.Append("]");
        return sb.ToString();
    }

    static string Esc(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
}
