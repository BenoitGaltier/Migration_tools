using System;
using System.IO;
using Fluidra.AltiumBridge;

internal static class ProjectMigrationPathsTests
{
    private static int checks;
    private static void Check(bool value) { if (!value) throw new Exception("Path validation assertion failed."); checks++; }
    private static void Refuses(string project, string root)
    {
        try { ProjectMigrationPaths.Validate(project, root); }
        catch (InvalidDataException) { checks++; return; }
        throw new Exception("An invalid migration path was accepted.");
    }
    public static void Main(string[] args)
    {
        if (args[0] == "--inspect")
        {
            var actual = ProjectMigrationPaths.Validate(args[2], args[1]);
            Console.WriteLine(actual.ProjectRelativePath);
            Console.WriteLine(actual.WorkingCopyPath);
            return;
        }
        string parent = Path.GetFullPath(args[0]);
        string root = Path.Combine(parent, "working-copy");
        Directory.CreateDirectory(Path.Combine(root, ".git"));
        Directory.CreateDirectory(Path.Combine(root, "iQ Bridge ZB"));
        string nested = Path.Combine(root, "iQ Bridge ZB", "Carte_Pool_Bridge.PrjPcb");
        File.WriteAllText(nested, "[Design]\r\nManagedProjectGUID=\r\n");
        string original = File.ReadAllText(nested);
        var layout = ProjectMigrationPaths.Validate(nested, root);
        Check(layout.ProjectRelativePath == "iQ Bridge ZB/Carte_Pool_Bridge.PrjPcb");
        Check(layout.WorkingCopyPath == root && layout.ProjectFullPath == nested);
        Check(File.ReadAllText(nested) == original);
        string rootProject = Path.Combine(root, "Root.PrjPcb");
        File.WriteAllText(rootProject, original);
        Check(ProjectMigrationPaths.Validate(rootProject, null).ProjectRelativePath == "Root.PrjPcb");
        Refuses(nested, Path.GetDirectoryName(nested));
        string sibling = root + "-another";
        Directory.CreateDirectory(sibling);
        string outside = Path.Combine(sibling, "Outside.PrjPcb");
        File.WriteAllText(outside, original);
        Refuses(outside, root);
        Refuses(Path.Combine(root, "missing.PrjPcb"), root);
        Console.WriteLine("{\"checks\":" + checks + "}");
    }
}
