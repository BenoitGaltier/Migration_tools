using System.Text.Json;
using OriginalCircuit.Altium;
using OriginalCircuit.Altium.Models.Pcb;
using OriginalCircuit.Altium.Models.Sch;
using OriginalCircuit.Altium.Rendering.Svg;
using OriginalCircuit.Eda.Models;
using OriginalCircuit.Eda.Models.Pcb;
using OriginalCircuit.Eda.Rendering;

const int ModelPositionLayer = 200;

if (args.Length is < 3 or > 4)
{
    Console.Error.WriteLine("Usage: Fluidra.AltiumRenderer <render2d|scene3d|inspect> <input> <output> [layer-ids]");
    return 2;
}

try
{
    var command = args[0];
    var input = Path.GetFullPath(args[1]);
    var output = Path.GetFullPath(args[2]);
    Directory.CreateDirectory(Path.GetDirectoryName(output)!);

    if (command.Equals("render2d", StringComparison.OrdinalIgnoreCase))
    {
        await Render2dAsync(input, output, args.Length == 4 ? ParseLayerIds(args[3]) : null);
    }
    else if (command.Equals("scene3d", StringComparison.OrdinalIgnoreCase))
    {
        await WriteScene3dAsync(input, output);
    }
    else if (command.Equals("inspect", StringComparison.OrdinalIgnoreCase))
    {
        await WriteInspectionAsync(input, output);
    }
    else
    {
        throw new ArgumentException($"Unknown command: {command}");
    }

    Console.WriteLine(JsonSerializer.Serialize(new { ok = true, output }));
    return 0;
}

catch (Exception exception)
{
    Console.Error.WriteLine(exception.ToString());
    return 1;
}

static async Task WriteInspectionAsync(string input, string output)
{
    if (!Path.GetExtension(input).Equals(".schlib", StringComparison.OrdinalIgnoreCase))
        throw new InvalidDataException("Inspection currently supports .SchLib files only.");
    var component = (await AltiumLibrary.OpenSchLibAsync(input)).AllComponents.OfType<SchComponent>().First();
    var groups = new List<object>();
    foreach (var property in component.GetType().GetProperties())
    {
        if (property.GetValue(component) is not System.Collections.IEnumerable collection
            || property.PropertyType == typeof(string)) continue;
        var items = new List<object>();
        foreach (var primitive in collection)
        {
            if (primitive is null) continue;
            var type = primitive.GetType();
            items.Add(new
            {
                type = type.Name,
                ownerPartId = type.GetProperty("OwnerPartId")?.GetValue(primitive),
                ownerPartDisplayMode = type.GetProperty("OwnerPartDisplayMode")?.GetValue(primitive),
                isHidden = type.GetProperty("IsHidden")?.GetValue(primitive)
            });
        }
        if (items.Count > 0) groups.Add(new { property = property.Name, count = items.Count, items });
    }
    await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new
    {
        component.Name,
        component.PartCount,
        component.CurrentPartId,
        component.DisplayModeCount,
        component.DisplayMode,
        groups
    }, new JsonSerializerOptions { WriteIndented = true }));
}

static async Task Render2dAsync(string input, string output, HashSet<int>? visibleLayers)
{
    IComponent component = Path.GetExtension(input).ToLowerInvariant() switch
    {
        ".schlib" => (await AltiumLibrary.OpenSchLibAsync(input)).AllComponents.FirstOrDefault()
            ?? throw new InvalidDataException("The SchLib contains no symbol."),
        ".pcblib" => (await AltiumLibrary.OpenPcbLibAsync(input)).AllComponents.FirstOrDefault()
            ?? throw new InvalidDataException("The PcbLib contains no footprint."),
        _ => throw new InvalidDataException("Only .SchLib and .PcbLib files are supported.")
    };

    if (component is SchComponent schComponent)
        NormalizeSharedSchematicPrimitives(schComponent);
    else if (component is PcbComponent pcbComponent)
        component = CreateFootprintPreview(pcbComponent, visibleLayers);

    await using var stream = File.Create(output);
    await new SvgRenderer().RenderAsync(component, stream, new RenderOptions
    {
        Width = 920,
        Height = 640,
        AutoZoom = true
    });
}

static void NormalizeSharedSchematicPrimitives(SchComponent component)
{
    // Altium uses both 0 and -1 for graphics shared by every part. The renderer's
    // part filter expects 0, so normalize the legacy value before calculating bounds.
    foreach (var collectionProperty in component.GetType().GetProperties())
    {
        if (collectionProperty.GetValue(component) is not System.Collections.IEnumerable collection
            || collectionProperty.PropertyType == typeof(string)) continue;
        foreach (var primitive in collection)
        {
            if (primitive is null) continue;
            var ownerPartProperty = primitive.GetType().GetProperty("OwnerPartId");
            if (ownerPartProperty?.CanRead != true || ownerPartProperty.CanWrite != true) continue;
            if (ownerPartProperty.GetValue(primitive) is int ownerPartId && ownerPartId < 0)
                ownerPartProperty.SetValue(primitive, 0);
        }
    }
}

static HashSet<int> ParseLayerIds(string value) => value.Split(',', StringSplitOptions.RemoveEmptyEntries)
    .Select(part => int.Parse(part, System.Globalization.CultureInfo.InvariantCulture))
    .ToHashSet();

static PcbComponent CreateFootprintPreview(PcbComponent source, HashSet<int>? visibleLayers)
{
    var preview = new PcbComponent
    {
        Name = source.Name,
        Description = source.Description,
        Comment = source.Comment,
        Height = source.Height
    };

    bool IsVisible(int layer) => visibleLayers is null || visibleLayers.Contains(layer);
    foreach (var pad in source.Pads.Cast<PcbPad>())
    {
        foreach (var projectedPad in ProjectPadLayers(pad))
            if (IsVisible(projectedPad.Layer)) preview.AddPad(projectedPad);
    }
    foreach (var track in source.Tracks.Cast<PcbTrack>().Where(item => IsVisible(item.Layer))) preview.AddTrack(track);
    foreach (var via in source.Vias.Cast<PcbVia>().Where(item => IsVisible(item.Layer))) preview.AddVia(via);
    foreach (var arc in source.Arcs.Cast<PcbArc>().Where(item => IsVisible(item.Layer))) preview.AddArc(arc);
    foreach (var text in source.Texts.Cast<PcbText>().Where(item => IsVisible(item.Layer))) preview.AddText(text);
    foreach (var fill in source.Fills.Cast<PcbFill>().Where(item => IsVisible(item.Layer))) preview.AddFill(fill);
    foreach (var region in source.Regions.Cast<PcbRegion>().Where(item => IsVisible(RegionLayer(item)))) preview.AddRegion(region);
    foreach (var body in source.ComponentBodies.Cast<PcbComponentBody>().Where(_ => IsVisible(ModelPositionLayer))) preview.AddComponentBody(body);

    return preview;
}

static async Task WriteScene3dAsync(string input, string output)
{
    if (!Path.GetExtension(input).Equals(".pcblib", StringComparison.OrdinalIgnoreCase))
        throw new InvalidDataException("The 3D scene is available only for .PcbLib files.");

    var library = (PcbLibrary)await AltiumLibrary.OpenPcbLibAsync(input);
    var component = library.Components.OfType<PcbComponent>().FirstOrDefault()
        ?? throw new InvalidDataException("The PcbLib contains no footprint.");
    var bounds = component.Bounds;
    var layerCounts = new Dictionary<int, int>();
    void AddLayer(int layer)
    {
        layerCounts[layer] = layerCounts.GetValueOrDefault(layer) + 1;
    }
    foreach (var item in component.Pads.Cast<PcbPad>())
        foreach (var padLayer in PadLayers(item)) AddLayer(padLayer);
    foreach (var item in component.Tracks.Cast<PcbTrack>()) AddLayer(item.Layer);
    foreach (var item in component.Vias.Cast<PcbVia>()) AddLayer(item.Layer);
    foreach (var item in component.Arcs.Cast<PcbArc>()) AddLayer(item.Layer);
    foreach (var item in component.Texts.Cast<PcbText>()) AddLayer(item.Layer);
    foreach (var item in component.Fills.Cast<PcbFill>()) AddLayer(item.Layer);
    foreach (var item in component.Regions.Cast<PcbRegion>()) AddLayer(RegionLayer(item));
    foreach (var item in component.ComponentBodies.Cast<PcbComponentBody>()) AddLayer(ModelPositionLayer);

    var scene = new
    {
        name = component.Name,
        layers = layerCounts.OrderBy(pair => LayerPriority(pair.Key)).ThenBy(pair => pair.Key).Select(pair => new
        {
            id = pair.Key,
            name = LayerName(pair.Key),
            color = LayerColor(pair.Key),
            count = pair.Value
        }),
        bounds = new
        {
            minX = Mm(bounds.Min.X), minY = Mm(bounds.Min.Y),
            maxX = Mm(bounds.Max.X), maxY = Mm(bounds.Max.Y)
        },
        pads = component.Pads.Cast<PcbPad>().SelectMany(ProjectPadLayers).Select(p => new
        {
            x = Mm(p.Location.X), y = Mm(p.Location.Y),
            width = PositiveMm(p.SizeTop.X), height = PositiveMm(p.SizeTop.Y),
            hole = Math.Max(0, Mm(p.HoleSize)), rotation = p.Rotation,
            shape = p.ShapeTop.ToString(), designator = p.Designator,
            layer = p.Layer
        }),
        vias = component.Vias.Cast<PcbVia>().Select(v => new
        {
            x = Mm(v.Location.X), y = Mm(v.Location.Y),
            width = PositiveMm(v.Diameter), height = PositiveMm(v.Diameter),
            hole = Math.Max(0, Mm(v.HoleSize)), rotation = 0,
            shape = "Round", designator = "", layer = v.Layer
        }),
        tracks = component.Tracks.Cast<PcbTrack>().Select(t => new
        {
            x1 = Mm(t.Start.X), y1 = Mm(t.Start.Y), x2 = Mm(t.End.X), y2 = Mm(t.End.Y),
            width = PositiveMm(t.Width), layer = t.Layer
        }),
        fills = component.Fills.Cast<PcbFill>().Select(f => new
        {
            x1 = Mm(f.Corner1.X), y1 = Mm(f.Corner1.Y), x2 = Mm(f.Corner2.X), y2 = Mm(f.Corner2.Y),
            rotation = f.Rotation, layer = f.Layer
        }),
        bodies = component.ComponentBodies.Cast<PcbComponentBody>().Select(b => new
        {
            name = b.ModelName ?? b.Name,
            standoff = Math.Max(0, Mm(b.StandoffHeight)),
            height = Math.Max(0.2, Mm(b.OverallHeight)),
            color = ColorHex(b.BodyColor3D), opacity = Math.Clamp(b.BodyOpacity3D, 0.05, 1),
            x = Mm(b.Model2DLocation.X), y = Mm(b.Model2DLocation.Y), rotation = b.Model2DRotation,
            outline = b.Outline.Select(p => new[] { Mm(p.X), Mm(p.Y) }), layer = ModelPositionLayer
        }),
        embeddedModelCount = library.Models.Count,
        diagnostics = library.Diagnostics.Select(d => d.ToString())
    };

    await File.WriteAllTextAsync(output, JsonSerializer.Serialize(scene, new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    }));
}

static double Mm(OriginalCircuit.Eda.Primitives.Coord value) => Math.Round(value.ToMm(), 6);
static double PositiveMm(OriginalCircuit.Eda.Primitives.Coord value) => Math.Max(0.02, Math.Abs(Mm(value)));

static IEnumerable<int> PadLayers(PcbPad pad)
{
    yield return pad.Layer;
    if (pad.Layer == 1)
    {
        if (!pad.IsTenting && !pad.IsTentingTop) yield return 37;
        if (IsPastePad(pad)) yield return 35;
    }
    else if (pad.Layer == 32)
    {
        if (!pad.IsTenting && !pad.IsTentingBottom) yield return 38;
        if (IsPastePad(pad)) yield return 36;
    }
    else if (pad.Layer == 74)
    {
        if (!pad.IsTenting && !pad.IsTentingTop) yield return 37;
        if (!pad.IsTenting && !pad.IsTentingBottom) yield return 38;
    }
}

static bool IsPastePad(PcbPad pad) => pad.HoleSize <= OriginalCircuit.Eda.Primitives.Coord.Zero
    && (pad.IsSurfaceMount || pad.Layer is 1 or 32);

static IEnumerable<PcbPad> ProjectPadLayers(PcbPad pad)
{
    yield return ClonePadForLayer(pad, pad.Layer, OriginalCircuit.Eda.Primitives.Coord.Zero);
    foreach (var layer in PadLayers(pad).Skip(1))
    {
        var expansion = layer is 35 or 36
            ? EffectiveExpansion(pad.PasteMaskExpansionMode, pad.PasteMaskExpansion)
            : EffectiveExpansion(pad.SolderMaskExpansionMode, pad.SolderMaskExpansion);
        yield return ClonePadForLayer(pad, layer, expansion);
    }
}

static OriginalCircuit.Eda.Primitives.Coord EffectiveExpansion(int mode, OriginalCircuit.Eda.Primitives.Coord manual) =>
    mode == 2 ? manual : OriginalCircuit.Eda.Primitives.Coord.Zero;

static PcbPad ClonePadForLayer(PcbPad source, int layer, OriginalCircuit.Eda.Primitives.Coord expansion)
{
    var delta = expansion + expansion;
    var size = new OriginalCircuit.Eda.Primitives.CoordPoint(
        source.SizeTop.X + delta,
        source.SizeTop.Y + delta);
    return new PcbPad
    {
        Designator = layer == source.Layer ? source.Designator : null,
        Location = source.Location,
        SizeTop = size,
        SizeMiddle = size,
        SizeBottom = size,
        ShapeTop = source.ShapeTop,
        ShapeMiddle = source.ShapeTop,
        ShapeBottom = source.ShapeTop,
        CornerRadiusPercentage = source.CornerRadiusPercentage,
        Rotation = source.Rotation,
        Layer = layer,
        HoleSize = layer == source.Layer ? source.HoleSize : OriginalCircuit.Eda.Primitives.Coord.Zero,
        HoleWidth = layer == source.Layer ? source.HoleWidth : OriginalCircuit.Eda.Primitives.Coord.Zero,
        HoleType = source.HoleType,
        HoleRotation = source.HoleRotation,
        IsPlated = source.IsPlated,
        Enabled = source.Enabled
    };
}

static int RegionLayer(PcbRegion region) => NamedLayerId(region.V7LayerName, region.Layer);
static int NamedLayerId(string? layerName, int fallback)
{
    var name = (layerName ?? string.Empty).Replace(" ", string.Empty).Replace("-", string.Empty).ToUpperInvariant();
    if (name is "TOP" or "TOPLAYER") return 1;
    if (name is "BOTTOM" or "BOTTOMLAYER") return 32;
    if (name == "TOPOVERLAY") return 33;
    if (name == "BOTTOMOVERLAY") return 34;
    if (name == "TOPPASTE") return 35;
    if (name == "BOTTOMPASTE") return 36;
    if (name == "TOPSOLDER") return 37;
    if (name == "BOTTOMSOLDER") return 38;
    if (name == "DRILLGUIDE") return 55;
    if (name is "KEEPOUT" or "KEEPOUTLAYER") return 56;
    if (name == "DRILLDRAWING") return 73;
    if (name is "MULTILAYER" or "MULTI") return 74;
    if (name.StartsWith("MID") && int.TryParse(name[3..], out var mid) && mid is >= 1 and <= 30) return mid + 1;
    if (name.StartsWith("INTERNALPLANE") && int.TryParse(name[13..], out var plane) && plane is >= 1 and <= 16) return plane + 38;
    if (name.StartsWith("MECHANICAL") && int.TryParse(name[10..], out var mechanical) && mechanical is >= 1 and <= 16) return mechanical + 56;
    return fallback;
}
static string LayerName(int layer) => layer switch
{
    1 => "Top Layer", 32 => "Bottom Layer", 33 => "Top Overlay", 34 => "Bottom Overlay",
    35 => "Top Paste", 36 => "Bottom Paste", 37 => "Top Solder", 38 => "Bottom Solder",
    55 => "Drill Guide", 56 => "Keep-Out Layer", 73 => "Drill Drawing", 74 => "Multi-Layer",
    81 => "Pad Holes", 82 => "Via Holes",
    ModelPositionLayer => "Mechanical - 3D Model Position",
    >= 2 and <= 31 => $"Mid-Layer {layer - 1}",
    >= 39 and <= 54 => $"Internal Plane {layer - 38}",
    >= 57 and <= 72 => $"Mechanical {layer - 56}",
    _ => $"Layer {layer}"
};
static int LayerPriority(int layer) => layer switch
{
    1 => 0, 32 => 1, 74 => 2, 33 => 3, 34 => 4,
    >= 35 and <= 38 => 5, >= 2 and <= 31 => 6, >= 39 and <= 54 => 7,
    >= 57 and <= 72 => 8, ModelPositionLayer => 9, _ => 10
};
static string LayerColor(int layer) => layer switch
{
    1 => "#d83b32", 32 => "#276dd8", 33 => "#d4a900", 34 => "#16858a",
    35 => "#6b7280", 36 => "#28324a", 37 => "#8b4aa0", 38 => "#d13ca4",
    55 => "#7f3545", 56 => "#d23fa8", 73 => "#ed304f", 74 => "#8b949e",
    81 => "#168b89", 82 => "#8a6721",
    ModelPositionLayer => "#da5f2a",
    >= 57 and <= 72 => new[] { "#c43aa3", "#7b4b93", "#278354", "#807923" }[(layer - 57) % 4],
    >= 2 and <= 31 => new[] { "#a9781f", "#41a5c9", "#299e61", "#925ec7" }[(layer - 2) % 4],
    >= 39 and <= 54 => new[] { "#36874b", "#87443f", "#7b4b93", "#27858b" }[(layer - 39) % 4],
    _ => "#68727d"
};
static string ColorHex(int color)
{
    var value = color & 0xFFFFFF;
    return $"#{value:X6}";
}
