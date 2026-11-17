using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChestCounter;

public sealed class ChestRecord
{
    public float TimeSeconds { get; set; }
    public string Kind { get; set; } = "";
    public string Blueprint { get; set; } = "";
    /// <summary>True when the chest was destroyed by the player instead of being opened.</summary>
    public bool Destroyed { get; set; }
    public List<string> Items { get; set; } = new();
    public List<string> TreasureItems { get; set; } = new();
}

public sealed class TreasureFind
{
    /// <summary>Name to display.</summary>
    public string DisplayName => PrizeId != null ? TreasureNames.Friendly(PrizeId) : Item;

    public string Item { get; set; } = "";
    public string RawItem { get; set; } = "";
    /// <summary>Prize id sent by the server with the golden chest, e.g. "DelilahPrize:dpid_item4".</summary>
    public string? PrizeId { get; set; }
    /// <summary>True when detected from the golden treasure chest itself.</summary>
    public bool FromGoldenChest { get; set; }
    /// <summary>True when detected only from the prize handler (exact time, item unknown unless sent at that moment).</summary>
    public bool FromPrizeHandler { get; set; }
    /// <summary>True when the time is exact (golden chest or prize handler), false when estimated.</summary>
    public bool TimeExact { get; set; }
    /// <summary>True when the source chest was destroyed rather than opened.</summary>
    public bool SourceDestroyed { get; set; }
    public string SourceLabel => SourceDestroyed ? $"{SourceKind} (destroyed)" : SourceKind;
    /// <summary>When it was obtained (replay seconds). Exact for golden chests, estimated otherwise.</summary>
    public float? ObtainedAtSeconds { get; set; }
    /// <summary>Kind of container / interaction it came from (Chest, Loot cannon...).</summary>
    public string SourceKind { get; set; } = "";
    public string SourceBlueprint { get; set; } = "";
    public bool SourceIsChest { get; set; } = true;
    /// <summary>True when the source is known for sure (golden chest), false when it is the last interaction before use.</summary>
    public bool SourceCertain { get; set; }
    /// <summary>For estimated sources: other (non-chest) interactions between the source and the first use.</summary>
    public List<string> AlsoPossible { get; set; } = new();
    /// <summary>Team treasure: name of the teammate whose chest gave it ("" when the teammate was out of sight).</summary>
    public string? Teammate { get; set; }
}

/// <summary>Chests of one teammate in a match, as recorded in the player's own replay.</summary>
public sealed class TeamChestCount
{
    public string Name { get; set; } = "";
    public string? EpicId { get; set; }
    public bool IsBot { get; set; }
    public int Chests { get; set; }
    public int Destroyed { get; set; }
}

/// <summary>A treasure seen in a match, from a golden chest opened by another player.</summary>
public sealed class SeenPrize
{
    public string Player { get; set; } = "";
    public string PrizeId { get; set; } = "";
    public float TimeSeconds { get; set; }
}

public sealed class MatchRecord
{
    public string SessionId { get; set; } = "";
    public string ReplayFile { get; set; } = "";
    public DateTime AnalyzedAtUtc { get; set; }
    public DateTime? MatchStartUtc { get; set; }
    public int? DurationSeconds { get; set; }
    public string? Playlist { get; set; }
    public string? GameVersion { get; set; }
    public string? PlayerName { get; set; }
    public string? EpicId { get; set; }
    public bool TrackedByUsername { get; set; }
    /// <summary>Set when none of the configured names played this match (name of the replay owner).</summary>
    public string? NotTrackedOwner { get; set; }
    public bool IsReplayOwner { get; set; }
    public int? Placement { get; set; }
    public int? TotalPlayers { get; set; }
    public int? Eliminations { get; set; }
    public int ChestsOpened { get; set; }
    public int AmmoBoxesOpened { get; set; }
    public int OtherContainersOpened { get; set; }
    /// <summary>Non-chest interactions by kind (loot cannons, ammo boxes, food boxes...).</summary>
    public Dictionary<string, int> OtherInteractions { get; set; } = new();
    public int AnalyzerVersion { get; set; } = 1;
    /// <summary>Kept for the files of older versions; what counts is decided by <see cref="GameModes.Counts"/>.</summary>
    public bool IsBattleRoyale { get; set; } = true;

    /// <summary>Map of the match, from the replay header (e.g. /Delilah/Maps/Delilah_Terrain). Null before version 1.5.</summary>
    public string? Map { get; set; }

    /// <summary>Private match (custom matchmaking key).</summary>
    public bool IsCustomMatch { get; set; }
    public List<ChestRecord> Chests { get; set; } = new();
    public List<TreasureFind> TreasureFinds { get; set; } = new();
    /// <summary>Treasures found by teammates (shared with the whole team). Not counted in the player's own totals.</summary>
    public List<TreasureFind> TeamTreasureFinds { get; set; } = new();

    /// <summary>
    /// Golden chests opened by other players (not the player, not a teammate) within reach of the replay (about 150 m):
    /// who got what, and when.
    /// </summary>
    public List<SeenPrize> SeenPrizes { get; set; } = new();

    /// <summary>Chests opened or destroyed by each teammate (random teammates included). Not in the player's own total.</summary>
    public List<TeamChestCount> TeamChests { get; set; } = new();
    public int TeamChestsOpened { get; set; }

    /// <summary>Time and distance spent in vehicles (driver or passenger).</summary>
    public int VehicleSeconds { get; set; }
    public int VehicleMeters { get; set; }

    /// <summary>
    /// Loot piles left along the player's drives with no recorded chest to explain them: Fortnite did not record
    /// what the vehicle destroyed in this replay, so chests are missing from the count (see GitHub issue 8).
    /// </summary>
    public int UnrecordedVehicleLoot { get; set; }

    /// <summary>From this many unexplained piles on, the match is flagged (one or two can be somebody else's loot).</summary>
    [JsonIgnore] public bool VehicleChestsMissing => UnrecordedVehicleLoot >= 3;
}
