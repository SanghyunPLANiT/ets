import React from "react";
import { fmt } from "./MarketChart.jsx";
import { YearSeriesModal, getSeriesFieldMeta } from "./AppShared.jsx";

export function Editor({
  scenario,
  year,
  onSave,
  onAddYear,
  onRemoveYear,
  onSelectYear,
  navigationTarget = null,
}) {
  const [workingScenario, setWorkingScenario] = React.useState(() => structuredClone(scenario));
  const [workingYear, setWorkingYear] = React.useState(() => structuredClone(year));
  const [activeStep, setActiveStep] = React.useState("scenario");
  const [selectedParticipantIndex, setSelectedParticipantIndex] = React.useState(0);
  const [selectedTechnologyIndex, setSelectedTechnologyIndex] = React.useState(0);
  const [selectedParticipantTemplate, setSelectedParticipantTemplate] = React.useState("steel_blast_furnace");
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [wizardArchetype, setWizardArchetype] = React.useState("auto");
  const [wizardReplacements, setWizardReplacements] = React.useState([]);
  const [wizardMode, setWizardMode] = React.useState("moderate");
  const [seriesEditor, setSeriesEditor] = React.useState(null);
  const participant = workingYear.participants?.[selectedParticipantIndex] || null;
  const technologyOptions = participant?.technology_options || [];
  const selectedTechnology = technologyOptions[selectedTechnologyIndex] || null;
  const participantNameLower = participant?.name?.toLowerCase() || "";

  React.useEffect(() => {
    setWorkingScenario(structuredClone(scenario));
    setWorkingYear(structuredClone(year));
    setSelectedParticipantIndex(0);
    setSelectedTechnologyIndex(0);
    setWizardOpen(false);
  }, [scenario.id, year.year]);

  React.useEffect(() => {
    if (selectedParticipantIndex >= (workingYear.participants || []).length) {
      setSelectedParticipantIndex(Math.max(0, (workingYear.participants || []).length - 1));
    }
  }, [workingYear.participants, selectedParticipantIndex]);

  React.useEffect(() => {
    const options = workingYear.participants?.[selectedParticipantIndex]?.technology_options || [];
    if (selectedTechnologyIndex >= options.length) {
      setSelectedTechnologyIndex(Math.max(0, options.length - 1));
    }
  }, [workingYear.participants, selectedParticipantIndex, selectedTechnologyIndex]);

  React.useEffect(() => {
    if (!participant) return;
    const autoArchetype =
      participant?.sector === "Power" && participantNameLower.includes("coal")
        ? "coal_transition"
        : participant?.sector === "Industry" && participantNameLower.includes("steel")
          ? "steel_transition"
          : participant?.sector === "Industry" && participantNameLower.includes("cement")
            ? "cement_transition"
            : participant?.sector === "Industry"
              ? "generic_industry"
              : "auto";
    setWizardArchetype(autoArchetype);
  }, [selectedParticipantIndex, participant?.sector, participantNameLower]);

  React.useEffect(() => {
    const allowed = wizardArchetypes[wizardArchetype]?.replacements || [];
    if (!allowed.length) {
      setWizardReplacements([]);
      return;
    }
    setWizardReplacements((current) => {
      const filtered = current.filter((item) => allowed.includes(item));
      return filtered.length ? filtered : [allowed[0]];
    });
  }, [wizardArchetype]);

  React.useEffect(() => {
    if (!navigationTarget) return;
    if (navigationTarget.step) {
      setActiveStep(navigationTarget.step);
    }
    if (navigationTarget.participantName) {
      const participantIndex = (workingYear.participants || []).findIndex(
        (item) => item.name === navigationTarget.participantName
      );
      if (participantIndex >= 0) {
        setSelectedParticipantIndex(participantIndex);
        const technologyName = navigationTarget.technologyName;
        if (technologyName) {
          const technologyIndex = (workingYear.participants?.[participantIndex]?.technology_options || []).findIndex(
            (item) => item.name === technologyName
          );
          if (technologyIndex >= 0) {
            setSelectedTechnologyIndex(technologyIndex);
          }
        }
      }
    }
  }, [navigationTarget, workingYear.participants]);

  const isDirty =
    JSON.stringify(workingScenario) !== JSON.stringify(scenario)
    || JSON.stringify(workingYear) !== JSON.stringify(year);

  const stepItems = [
    { id: "scenario", label: "1. Scenario" },
    { id: "market", label: "2. Market Rules" },
    { id: "participants", label: "3. Participants" },
    { id: "review", label: "4. Review" },
  ];

  const fieldHelp = {
    abatement_type: "Choose the participant abatement model: linear, threshold, or piecewise MAC blocks.",
    max_abatement: "Maximum abatement volume available to this participant.",
    cost_slope: "Used only for linear abatement. Lower slope means cheaper marginal abatement.",
    threshold_cost: "Used only for threshold abatement. Abatement activates when carbon price reaches this cost.",
    mac_blocks: "Used only for piecewise abatement. Enter blocks as amount@cost; amount@cost.",
    fixed_cost: "Fixed annual technology cost paid if this technology option is chosen.",
  };

  const scenarioYearsWithDraft = React.useMemo(
    () =>
      (workingScenario.years || []).map((item) =>
        String(item.year) === String(year.year) ? structuredClone(workingYear) : item
      ),
    [workingScenario.years, workingYear, year.year]
  );

  const wizardArchetypes = {
    auto: {
      label: "Auto detect",
      replacements: ["hydrogen_dri", "ccs_retrofit"],
      description: "Choose replacements based on the selected participant name and sector.",
    },
    steel_transition: {
      label: "Steel transition",
      replacements: ["hydrogen_dri", "scrap_eaf", "ccs_retrofit"],
      description: "Incumbent steel route moving toward hydrogen DRI, EAF, or CCS retrofit.",
    },
    coal_transition: {
      label: "Coal power transition",
      replacements: ["renewables_storage", "gas_ccs", "ccs_retrofit"],
      description: "Coal fleet moving toward renewables plus storage, gas with CCS, or retrofit.",
    },
    cement_transition: {
      label: "Cement transition",
      replacements: ["ccs_retrofit", "clinker_substitution"],
      description: "Cement kiln moving toward CCS retrofit or clinker substitution.",
    },
    generic_industry: {
      label: "Generic industry retrofit",
      replacements: ["ccs_retrofit", "electrification"],
      description: "Generic industrial asset moving toward low-carbon retrofit options.",
    },
  };

  const replacementCatalog = {
    hydrogen_dri: {
      label: "Hydrogen DRI",
      emissionsMultiplier: 0.42,
      freeRatioMultiplier: 0.8,
      fixedCostMultiplier: 1.1,
      blockCostMultiplier: 0.58,
      blockAmountMultiplier: 1.15,
    },
    scrap_eaf: {
      label: "Scrap EAF",
      emissionsMultiplier: 0.3,
      freeRatioMultiplier: 0.7,
      fixedCostMultiplier: 0.95,
      blockCostMultiplier: 0.52,
      blockAmountMultiplier: 1.1,
    },
    renewables_storage: {
      label: "Renewables + Storage",
      emissionsMultiplier: 0.12,
      freeRatioMultiplier: 0.35,
      fixedCostMultiplier: 0.7,
      blockCostMultiplier: 0.45,
      blockAmountMultiplier: 1.25,
    },
    gas_ccs: {
      label: "Gas + CCS",
      emissionsMultiplier: 0.38,
      freeRatioMultiplier: 0.7,
      fixedCostMultiplier: 0.85,
      blockCostMultiplier: 0.62,
      blockAmountMultiplier: 1.05,
    },
    ccs_retrofit: {
      label: "CCS Retrofit",
      emissionsMultiplier: 0.55,
      freeRatioMultiplier: 0.85,
      fixedCostMultiplier: 0.9,
      blockCostMultiplier: 0.7,
      blockAmountMultiplier: 1.05,
    },
    clinker_substitution: {
      label: "Clinker Substitution",
      emissionsMultiplier: 0.68,
      freeRatioMultiplier: 0.85,
      fixedCostMultiplier: 0.55,
      blockCostMultiplier: 0.72,
      blockAmountMultiplier: 0.95,
    },
    electrification: {
      label: "Electrification",
      emissionsMultiplier: 0.48,
      freeRatioMultiplier: 0.75,
      fixedCostMultiplier: 0.8,
      blockCostMultiplier: 0.6,
      blockAmountMultiplier: 1.1,
    },
  };

  const wizardModeConfig = {
    conservative: { emissions: 1.05, fixedCost: 1.15, blockCost: 1.1, blockAmount: 0.95 },
    moderate: { emissions: 1.0, fixedCost: 1.0, blockCost: 1.0, blockAmount: 1.0 },
    aggressive: { emissions: 0.92, fixedCost: 0.9, blockCost: 0.9, blockAmount: 1.08 },
  };

  const participantTemplates = {
    steel_blast_furnace: {
      name: "Steel Blast Furnace",
      sector: "Industry",
      initial_emissions: 100,
      free_allocation_ratio: 0.9,
      penalty_price: Math.max(250, workingYear.price_upper_bound || 100),
      abatement_type: "piecewise",
      max_abatement: 22,
      cost_slope: 1,
      threshold_cost: 0,
      mac_blocks: [
        { amount: 6, marginal_cost: 20 },
        { amount: 8, marginal_cost: 55 },
        { amount: 8, marginal_cost: 110 },
      ],
      technology_options: [],
    },
    steel_hydrogen_dri: {
      name: "Steel Hydrogen DRI",
      sector: "Industry",
      initial_emissions: 70,
      free_allocation_ratio: 0.65,
      penalty_price: Math.max(250, workingYear.price_upper_bound || 100),
      abatement_type: "piecewise",
      max_abatement: 26,
      cost_slope: 1,
      threshold_cost: 0,
      mac_blocks: [
        { amount: 8, marginal_cost: 15 },
        { amount: 10, marginal_cost: 35 },
        { amount: 8, marginal_cost: 70 },
      ],
      technology_options: [],
    },
    coal_generator: {
      name: "Coal Generator",
      sector: "Power",
      initial_emissions: 140,
      free_allocation_ratio: 0.25,
      penalty_price: Math.max(250, workingYear.price_upper_bound || 100),
      abatement_type: "piecewise",
      max_abatement: 40,
      cost_slope: 1,
      threshold_cost: 0,
      mac_blocks: [
        { amount: 8, marginal_cost: 25 },
        { amount: 12, marginal_cost: 50 },
        { amount: 20, marginal_cost: 95 },
      ],
      technology_options: [],
    },
    renewable_generator: {
      name: "Renewable Generator",
      sector: "Power",
      initial_emissions: 5,
      free_allocation_ratio: 0,
      penalty_price: Math.max(250, workingYear.price_upper_bound || 100),
      abatement_type: "piecewise",
      max_abatement: 4,
      cost_slope: 1,
      threshold_cost: 0,
      mac_blocks: [
        { amount: 2, marginal_cost: 5 },
        { amount: 2, marginal_cost: 12 },
      ],
      technology_options: [],
    },
    cement_kiln: {
      name: "Cement Kiln",
      sector: "Industry",
      initial_emissions: 85,
      free_allocation_ratio: 0.75,
      penalty_price: Math.max(250, workingYear.price_upper_bound || 100),
      abatement_type: "piecewise",
      max_abatement: 24,
      cost_slope: 1,
      threshold_cost: 0,
      mac_blocks: [
        { amount: 5, marginal_cost: 18 },
        { amount: 7, marginal_cost: 48 },
        { amount: 12, marginal_cost: 115 },
      ],
      technology_options: [],
    },
  };

  const blankParticipant = (index) => ({
    name: `Participant ${index}`,
    sector: "Other",
    initial_emissions: 0,
    free_allocation_ratio: 0,
    penalty_price: workingYear.price_upper_bound || 100,
    abatement_type: "linear",
    max_abatement: 0,
    cost_slope: 1,
    threshold_cost: 0,
    mac_blocks: [],
    technology_options: [],
  });

  const blankTechnologyOption = (index) => ({
    name: `Technology ${index}`,
    initial_emissions: participant?.initial_emissions || 0,
    free_allocation_ratio: participant?.free_allocation_ratio || 0,
    penalty_price: participant?.penalty_price || workingYear.price_upper_bound || 100,
    abatement_type: participant?.abatement_type || "linear",
    max_abatement: participant?.max_abatement || 0,
    cost_slope: participant?.cost_slope || 1,
    threshold_cost: participant?.threshold_cost || 0,
    mac_blocks: [],
    fixed_cost: 0,
    max_activity_share: 1,
  });

  const serializeMacBlocks = (item) =>
    (item?.mac_blocks || [])
      .map((block) => `${block.amount}@${block.marginal_cost}`)
      .join("; ");

  const parseMacBlocks = (rawValue) => {
    const trimmed = rawValue.trim();
    if (!trimmed) return [];
    return trimmed
      .split(";")
      .map((item) => {
        const [amountText, costText] = item.split("@").map((value) => value.trim());
        return {
          amount: Number(amountText || 0),
          marginal_cost: Number(costText || 0),
        };
      })
      .filter((block) => !Number.isNaN(block.amount) && !Number.isNaN(block.marginal_cost));
  };

  const numInput = (value, onValueChange, step = 1, min = undefined, title = "") => (
    <input
      type="number"
      className="num"
      value={value}
      step={step}
      min={min}
      title={title}
      onChange={(event) => onValueChange(Number(event.target.value))}
    />
  );

  const updateScenario = (patch) => setWorkingScenario((current) => ({ ...current, ...patch }));
  const updateYear = (patch) => setWorkingYear((current) => ({ ...current, ...patch }));

  const updateParticipants = (participants) => setWorkingYear((current) => ({ ...current, participants }));

  const syncScenarioYearDraft = (nextYearDraft) => {
    setWorkingScenario((current) => ({
      ...current,
      years: (current.years || []).map((item) =>
        String(item.year) === String(year.year) ? structuredClone(nextYearDraft) : item
      ),
    }));
  };

  const updateParticipant = (index, patch) => {
    const participants = (workingYear.participants || []).map((item, rowIndex) =>
      rowIndex === index ? { ...item, ...patch } : item
    );
    updateParticipants(participants);
  };

  const updateTechnologyOption = (participantIndex, technologyIndex, patch) => {
    const participants = (workingYear.participants || []).map((item, rowIndex) => {
      if (rowIndex !== participantIndex) return item;
      const nextOptions = (item.technology_options || []).map((option, optionIndex) =>
        optionIndex === technologyIndex ? { ...option, ...patch } : option
      );
      return { ...item, technology_options: nextOptions };
    });
    updateParticipants(participants);
  };

  const updateMacBlocks = (record, onPatch, updater) => {
    const nextBlocks = updater([...(record?.mac_blocks || [])]).map((block) => ({
      amount: Number(block.amount || 0),
      marginal_cost: Number(block.marginal_cost || 0),
    }));
    onPatch({
      mac_blocks: nextBlocks,
      max_abatement: nextBlocks.length
        ? nextBlocks.reduce((sum, block) => sum + Number(block.amount || 0), 0)
        : record.max_abatement || 0,
    });
  };

  const applyParticipantTemplate = (templateKey, mode = "add") => {
    const template = participantTemplates[templateKey];
    if (!template) return;
    const nextRecord = structuredClone(template);
    if (mode === "replace" && participant) {
      updateParticipant(selectedParticipantIndex, {
        ...nextRecord,
        technology_options: participant.technology_options || nextRecord.technology_options,
      });
      return;
    }
    const participants = [...(workingYear.participants || []), nextRecord];
    updateParticipants(participants);
    setSelectedParticipantIndex(participants.length - 1);
    setSelectedTechnologyIndex(0);
    setActiveStep("participants");
  };

  const addParticipant = () => {
    const nextIndex = (workingYear.participants || []).length + 1;
    const participants = [...(workingYear.participants || []), blankParticipant(nextIndex)];
    updateParticipants(participants);
    setSelectedParticipantIndex(participants.length - 1);
    setSelectedTechnologyIndex(0);
    setActiveStep("participants");
  };

  const duplicateParticipant = (index) => {
    const source = workingYear.participants?.[index];
    if (!source) return;
    const participants = [...(workingYear.participants || [])];
    participants.splice(index + 1, 0, {
      ...structuredClone(source),
      name: `${source.name} Copy`,
    });
    updateParticipants(participants);
    setSelectedParticipantIndex(index + 1);
  };

  const removeParticipant = (index) => {
    const participants = (workingYear.participants || []).filter((_, rowIndex) => rowIndex !== index);
    updateParticipants(participants);
  };

  const addTechnologyOption = (participantIndex) => {
    const participantRecord = workingYear.participants?.[participantIndex];
    if (!participantRecord) return;
    const nextOptionIndex = (participantRecord.technology_options || []).length + 1;
    const participants = (workingYear.participants || []).map((item, rowIndex) => {
      if (rowIndex !== participantIndex) return item;
      return {
        ...item,
        technology_options: [...(item.technology_options || []), blankTechnologyOption(nextOptionIndex)],
      };
    });
    updateParticipants(participants);
    setSelectedTechnologyIndex(nextOptionIndex - 1);
  };

  const removeTechnologyOption = (participantIndex, technologyIndex) => {
    const participants = (workingYear.participants || []).map((item, rowIndex) => {
      if (rowIndex !== participantIndex) return item;
      return {
        ...item,
        technology_options: (item.technology_options || []).filter((_, optionIndex) => optionIndex !== technologyIndex),
      };
    });
    updateParticipants(participants);
    setSelectedTechnologyIndex(0);
  };

  const buildTechnologyPathway = (participantIndex) => {
    const source = workingYear.participants?.[participantIndex];
    if (!source) return;
    const incumbentName = source.name || `Participant ${participantIndex + 1}`;
    const lowCarbonName =
      source.sector === "Power"
        ? "Renewables + Storage"
        : source.name?.toLowerCase().includes("steel")
          ? "Hydrogen DRI"
          : "Low-Carbon Retrofit";
    const incumbent = {
      name: `${incumbentName} Incumbent`,
      initial_emissions: Number(source.initial_emissions || 0),
      free_allocation_ratio: Number(source.free_allocation_ratio || 0),
      penalty_price: Number(source.penalty_price || workingYear.price_upper_bound || 100),
      abatement_type: source.abatement_type || "piecewise",
      max_abatement: Number(source.max_abatement || 0),
      cost_slope: Number(source.cost_slope || 1),
      threshold_cost: Number(source.threshold_cost || 0),
      mac_blocks: structuredClone(source.mac_blocks || []),
      fixed_cost: 0,
    };
    const lowCarbonBlocks = source.abatement_type === "piecewise" && (source.mac_blocks || []).length
      ? source.mac_blocks.map((block, index) => ({
          amount: Math.max(1, Math.round(Number(block.amount || 0) * (index === 0 ? 1.1 : 1.2))),
          marginal_cost: Math.max(1, Math.round(Number(block.marginal_cost || 0) * 0.65)),
        }))
      : [
          { amount: Math.max(1, Math.round(Number(source.max_abatement || 0) * 0.4)), marginal_cost: 15 },
          { amount: Math.max(1, Math.round(Number(source.max_abatement || 0) * 0.6)), marginal_cost: 40 },
        ];
    const lowCarbon = {
      name: lowCarbonName,
      initial_emissions: Math.max(0, Number(source.initial_emissions || 0) * (source.sector === "Power" ? 0.15 : 0.55)),
      free_allocation_ratio: Math.max(0, Number(source.free_allocation_ratio || 0) * 0.8),
      penalty_price: Number(source.penalty_price || workingYear.price_upper_bound || 100),
      abatement_type: "piecewise",
      max_abatement: lowCarbonBlocks.reduce((sum, block) => sum + Number(block.amount || 0), 0),
      cost_slope: 1,
      threshold_cost: 0,
      mac_blocks: lowCarbonBlocks,
      fixed_cost: Math.max(25, Math.round(Number(source.initial_emissions || 0) * (source.sector === "Power" ? 0.45 : 0.85))),
      max_activity_share: 1,
    };
    updateParticipant(participantIndex, { technology_options: [incumbent, lowCarbon] });
    setSelectedTechnologyIndex(1);
  };

  const toggleWizardReplacement = (replacementId) => {
    setWizardReplacements((current) =>
      current.includes(replacementId)
        ? current.filter((item) => item !== replacementId)
        : [...current, replacementId]
    );
  };

  const deriveBlocksForReplacement = (source, replacementId) => {
    const replacement = replacementCatalog[replacementId];
    const mode = wizardModeConfig[wizardMode];
    const sourceBlocks = source?.mac_blocks?.length
      ? source.mac_blocks
      : [
          { amount: Math.max(1, Math.round(Number(source?.max_abatement || 10) * 0.35)), marginal_cost: 20 },
          { amount: Math.max(1, Math.round(Number(source?.max_abatement || 10) * 0.65)), marginal_cost: 60 },
        ];
    return sourceBlocks.map((block) => ({
      amount: Math.max(1, Math.round(Number(block.amount || 0) * replacement.blockAmountMultiplier * mode.blockAmount)),
      marginal_cost: Math.max(1, Math.round(Number(block.marginal_cost || 0) * replacement.blockCostMultiplier * mode.blockCost)),
    }));
  };

  const buildWizardPreview = () => {
    if (!participant) return [];
    const baseName = participant.name || `Participant ${selectedParticipantIndex + 1}`;
    const mode = wizardModeConfig[wizardMode];
    const incumbent = {
      name: `${baseName} Incumbent`,
      initial_emissions: Number(participant.initial_emissions || 0),
      free_allocation_ratio: Number(participant.free_allocation_ratio || 0),
      penalty_price: Number(participant.penalty_price || workingYear.price_upper_bound || 100),
      abatement_type: participant.abatement_type || "piecewise",
      max_abatement: Number(participant.max_abatement || 0),
      cost_slope: Number(participant.cost_slope || 1),
      threshold_cost: Number(participant.threshold_cost || 0),
      mac_blocks: structuredClone(participant.mac_blocks || []),
      fixed_cost: 0,
      max_activity_share: 1,
    };
    const lowCarbonOptions = wizardReplacements
      .map((replacementId) => {
        const replacement = replacementCatalog[replacementId];
        if (!replacement) return null;
        const macBlocks = deriveBlocksForReplacement(participant, replacementId);
        return {
          name: replacement.label,
          initial_emissions: Math.max(
            0,
            Number(participant.initial_emissions || 0) * replacement.emissionsMultiplier * mode.emissions
          ),
          free_allocation_ratio: Math.max(
            0,
            Math.min(1, Number(participant.free_allocation_ratio || 0) * replacement.freeRatioMultiplier)
          ),
          penalty_price: Number(participant.penalty_price || workingYear.price_upper_bound || 100),
          abatement_type: "piecewise",
          max_abatement: macBlocks.reduce((sum, block) => sum + Number(block.amount || 0), 0),
          cost_slope: 1,
          threshold_cost: 0,
          mac_blocks: macBlocks,
          fixed_cost: Math.max(
            10,
            Math.round(Number(participant.initial_emissions || 0) * replacement.fixedCostMultiplier * mode.fixedCost)
          ),
          max_activity_share: 1,
        };
      })
      .filter(Boolean);
    return [incumbent, ...lowCarbonOptions];
  };

  const applyWizardPathway = () => {
    if (!participant) return;
    const preview = buildWizardPreview();
    updateParticipant(selectedParticipantIndex, { technology_options: preview });
    setSelectedTechnologyIndex(Math.min(1, Math.max(0, preview.length - 1)));
    setWizardOpen(false);
  };

  const renderMacBlockEditor = (record, onPatch, prefix = "") => {
    const blocks = record?.mac_blocks || [];
    return (
      <div className="builder-mac">
        <div className="builder-card-subhead compact">
          <div>
            <div className="eyebrow">Visual MAC blocks</div>
            <div className="muted">Add abatement blocks as tonnage and marginal cost steps.</div>
          </div>
          <div className="editor-actions">
            <button
              className="ghost-btn"
              type="button"
              onClick={() => updateMacBlocks(record, onPatch, (items) => [...items, { amount: 5, marginal_cost: 20 }])}
            >
              Add block
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() =>
                updateMacBlocks(record, onPatch, () => [
                  { amount: 5, marginal_cost: 15 },
                  { amount: 8, marginal_cost: 35 },
                  { amount: 10, marginal_cost: 75 },
                ])
              }
            >
              Load starter
            </button>
          </div>
        </div>
        {blocks.length ? (
          <div className="builder-mac-table">
            <div className="builder-mac-head">
              <span>Block</span>
              <span>Amount</span>
              <span>Marginal cost</span>
              <span></span>
            </div>
            {blocks.map((block, index) => (
              <div key={`${prefix}mac-${index}`} className="builder-mac-row">
                <span className="builder-mac-index">{index + 1}</span>
                {numInput(
                  block.amount || 0,
                  (value) =>
                    updateMacBlocks(record, onPatch, (items) =>
                      items.map((item, itemIndex) => itemIndex === index ? { ...item, amount: value } : item)
                    ),
                  1,
                  0
                )}
                {numInput(
                  block.marginal_cost || 0,
                  (value) =>
                    updateMacBlocks(record, onPatch, (items) =>
                      items.map((item, itemIndex) => itemIndex === index ? { ...item, marginal_cost: value } : item)
                    ),
                  1,
                  0
                )}
                <button
                  className="ghost-btn danger-btn"
                  type="button"
                  onClick={() => updateMacBlocks(record, onPatch, (items) => items.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="builder-empty">No MAC blocks yet. Add a block or load a starter profile.</div>
        )}
        <label className="builder-span-2">
          <span className="ekey">{prefix}MAC blocks raw</span>
          <input
            className="text"
            value={serializeMacBlocks(record)}
            onChange={(event) => onPatch({ mac_blocks: parseMacBlocks(event.target.value) })}
            placeholder="6@20; 8@55; 8@110"
            title={fieldHelp.mac_blocks}
          />
        </label>
      </div>
    );
  };

  const renderAbatementFields = (record, onPatch, prefix = "") => (
    <div className="builder-form-grid">
      <label>
        <span className="ekey">{prefix}Abatement type</span>
        <select
          value={record.abatement_type || "linear"}
          onChange={(event) => onPatch({ abatement_type: event.target.value })}
          title={fieldHelp.abatement_type}
        >
          <option value="linear">linear</option>
          <option value="threshold">threshold</option>
          <option value="piecewise">piecewise</option>
        </select>
      </label>
      <label>
        <span className="ekey">{prefix}Max abate</span>
        {numInput(record.max_abatement || 0, (value) => onPatch({ max_abatement: value }), 1, 0, fieldHelp.max_abatement)}
      </label>
      <label>
        <span className="ekey">{prefix}Cost slope</span>
        {numInput(record.cost_slope || 0, (value) => onPatch({ cost_slope: value }), 0.1, 0, fieldHelp.cost_slope)}
      </label>
      <label>
        <span className="ekey">{prefix}Threshold cost</span>
        {numInput(record.threshold_cost || 0, (value) => onPatch({ threshold_cost: value }), 0.1, 0, fieldHelp.threshold_cost)}
      </label>
      <label className="builder-span-2">
        <span className="ekey">{prefix}MAC block editor</span>
        {renderMacBlockEditor(record, onPatch, prefix)}
      </label>
    </div>
  );

  const openMarketSeriesEditor = (field) => {
    setSeriesEditor({
      type: "market",
      title: getSeriesFieldMeta(field).label,
      field,
      values: Object.fromEntries(
        scenarioYearsWithDraft.map((item) => [String(item.year), Number(item[field] ?? 0)])
      ),
      description: "Edit this market-rule trajectory across all scenario years using a chart or the table.",
    });
  };

  const openParticipantSeriesEditor = (field) => {
    if (!participant) return;
    setSeriesEditor({
      type: "participant",
      title: `${participant.name || "Participant"} · ${getSeriesFieldMeta(field).label}`,
      field,
      values: Object.fromEntries(
        scenarioYearsWithDraft.map((item) => [
          String(item.year),
          Number(item.participants?.[selectedParticipantIndex]?.[field] ?? 0),
        ])
      ),
      description: "Edit the selected participant across all years. The same participant index is updated year by year.",
      participantIndex: selectedParticipantIndex,
    });
  };

  const openTechnologySeriesEditor = (field) => {
    if (!selectedTechnology) return;
    setSeriesEditor({
      type: "technology",
      title: `${selectedTechnology.name || "Technology"} · ${getSeriesFieldMeta(field).label}`,
      field,
      values: Object.fromEntries(
        scenarioYearsWithDraft.map((item) => [
          String(item.year),
          Number(item.participants?.[selectedParticipantIndex]?.technology_options?.[selectedTechnologyIndex]?.[field] ?? 0),
        ])
      ),
      description: "Edit this technology option across all years. The selected participant and technology index are updated year by year.",
      participantIndex: selectedParticipantIndex,
      technologyIndex: selectedTechnologyIndex,
    });
  };

  const applySeriesEdit = (field, valuesByYear) => {
    setWorkingScenario((current) => {
      const nextYears = scenarioYearsWithDraft.map((item) => {
        const yearKey = String(item.year);
        const nextValue = valuesByYear[yearKey];
        if (seriesEditor?.type === "market") {
          return { ...item, [field]: nextValue ?? item[field] };
        }
        if (seriesEditor?.type === "participant") {
          const participants = (item.participants || []).map((entry, index) =>
            index === seriesEditor.participantIndex ? { ...entry, [field]: nextValue ?? entry[field] } : entry
          );
          return { ...item, participants };
        }
        if (seriesEditor?.type === "technology") {
          const participants = (item.participants || []).map((entry, index) => {
            if (index !== seriesEditor.participantIndex) return entry;
            const technologyOptions = (entry.technology_options || []).map((option, optionIndex) =>
              optionIndex === seriesEditor.technologyIndex ? { ...option, [field]: nextValue ?? option[field] } : option
            );
            return { ...entry, technology_options: technologyOptions };
          });
          return { ...item, participants };
        }
        return item;
      });
      const currentYearDraft = nextYears.find((item) => String(item.year) === String(workingYear.year)) || workingYear;
      setWorkingYear(structuredClone(currentYearDraft));
      return { ...current, years: nextYears };
    });
  };

  const fieldWithPathButton = (label, onClick, required = false, optional = false) => (
    <span className="field-title-row">
      <span>
        {label}{" "}
        {required ? <span className="field-flag required">required</span> : null}
        {optional ? <span className="field-flag optional">optional</span> : null}
      </span>
      <button className="field-path-btn" type="button" onClick={onClick}>Edit path</button>
    </span>
  );

  return (
    <div className="editor builder">
      <div className="editor-toolbar">
        <div>
          <div className="eyebrow">Scenario builder</div>
          <h3>Build {workingScenario.name} step by step</h3>
        </div>
        <div className="editor-actions">
          <button
            className="ghost-btn"
            type="button"
            onClick={() => {
              setWorkingScenario(structuredClone(scenario));
              setWorkingYear(structuredClone(year));
            }}
            disabled={!isDirty}
          >
            Discard changes
          </button>
          <button
            className={"ghost-btn on " + (isDirty ? "edited-btn" : "")}
            type="button"
            onClick={() => onSave?.(workingScenario, workingYear, String(year.year))}
            disabled={!isDirty}
          >
            Save changes
          </button>
          <button className="ghost-btn" type="button" onClick={onAddYear}>Add year</button>
          <button
            className="ghost-btn"
            type="button"
            onClick={onRemoveYear}
            disabled={(workingScenario.years || []).length <= 1}
          >
            Remove year
          </button>
          <button className="ghost-btn on" type="button" onClick={addParticipant}>Add participant</button>
        </div>
      </div>

      <div className="builder-steps">
        {stepItems.map((step) => (
          <button
            key={step.id}
            type="button"
            className={"builder-step " + (activeStep === step.id ? "on" : "")}
            onClick={() => setActiveStep(step.id)}
          >
            {step.label}
          </button>
        ))}
      </div>

      {activeStep === "scenario" && (
        <section className="editor-section">
          <div className="editor-section-title">Scenario definition</div>
          <div className="editor-field-legend">
            <span className="field-flag required">required</span>
            <span className="field-flag optional">optional</span>
          </div>
          <div className="builder-form-grid">
            <label>
              <span className="ekey">Scenario name <span className="field-flag required">required</span></span>
              <input
                className="text"
                value={workingScenario.name || ""}
                onChange={(event) => updateScenario({ name: event.target.value })}
              />
            </label>
            <label>
              <span className="ekey">Scenario color <span className="field-flag optional">optional</span></span>
              <div className="color-input">
                <input
                  type="color"
                  value={workingScenario.color || "#1f6f55"}
                  onChange={(event) => updateScenario({ color: event.target.value })}
                />
                <input
                  className="text"
                  value={workingScenario.color || "#1f6f55"}
                  onChange={(event) => updateScenario({ color: event.target.value })}
                />
              </div>
            </label>
            <label className="builder-span-2">
              <span className="ekey">Scenario description <span className="field-flag optional">optional</span></span>
              <textarea
                className="text builder-textarea"
                value={workingScenario.description || ""}
                onChange={(event) => updateScenario({ description: event.target.value })}
              />
            </label>
          </div>
        </section>
      )}

      {activeStep === "market" && (
        <section className="editor-section">
          <div className="editor-section-title">Year {workingYear.year} market rules</div>
          <div className="editor-field-legend">
            <span className="field-flag required">required</span>
            <span className="field-flag optional">optional</span>
          </div>

          {/* ── Modelling approach selector ── */}
          <div className="approach-selector">
            <div className="approach-selector-label">Modelling approach</div>
            <div className="approach-selector-options">
              {[
                { id: "competitive", label: "Competitive", sub: "Walrasian price-taking equilibrium (default)" },
                { id: "hotelling",   label: "Hotelling Rule", sub: "Optimal depletion — price rises at discount rate" },
                { id: "nash_cournot", label: "Nash–Cournot", sub: "Strategic participants with market power" },
                { id: "all",         label: "Run All", sub: "Compare all three approaches simultaneously" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={"approach-option " + ((workingScenario.model_approach || "competitive") === opt.id ? "on" : "")}
                  onClick={() => updateScenario({ model_approach: opt.id })}
                >
                  <span className="approach-option-label">{opt.label}</span>
                  <span className="approach-option-sub">{opt.sub}</span>
                </button>
              ))}
            </div>

            {/* Hotelling extra fields */}
            {(workingScenario.model_approach === "hotelling" || workingScenario.model_approach === "all") && (
              <div className="approach-params">
                <label>
                  <span className="ekey">Discount rate <span className="field-flag optional">optional</span></span>
                  <input
                    type="number"
                    className="text"
                    step="0.01"
                    min="0"
                    max="0.5"
                    value={workingScenario.discount_rate ?? 0.04}
                    onChange={(e) => updateScenario({ discount_rate: parseFloat(e.target.value) || 0.04 })}
                  />
                  <span className="approach-params-hint">Annual discount rate r — Hotelling price path grows at (1+r)^t. Default 0.04 = 4%.</span>
                </label>
                <label>
                  <span className="ekey">Carbon budget (this year) <span className="field-flag optional">optional</span></span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      className="text"
                      step="1"
                      min="0"
                      value={workingYear.carbon_budget || 0}
                      onChange={(e) => updateYear({ carbon_budget: parseFloat(e.target.value) || 0 })}
                    />
                    <button type="button" className="ghost-btn" style={{ flexShrink: 0 }}
                      onClick={() => openMarketSeriesEditor("carbon_budget")}>
                      Edit pathway ↗
                    </button>
                  </div>
                  <span className="approach-params-hint">Mt CO₂e allowed this year. Set across all years using the pathway chart.</span>
                </label>
              </div>
            )}

            {/* Nash extra fields */}
            {(workingScenario.model_approach === "nash_cournot" || workingScenario.model_approach === "all") && (
              <div className="approach-params">
                <div className="ekey" style={{ marginBottom: 6 }}>
                  Strategic participants <span className="field-flag optional">optional</span>
                  <span className="approach-params-hint" style={{ display: "block", marginTop: 2 }}>
                    Select which participants behave strategically (internalize price impact). Leave all unchecked to make everyone strategic.
                  </span>
                </div>
                <div className="approach-nash-participants">
                  {(workingYear.participants || []).length === 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>No participants yet — add them in Step 3.</span>
                  )}
                  {(workingYear.participants || []).map((p) => {
                    const isStrategic = !(workingScenario.nash_strategic_participants?.length) ||
                      (workingScenario.nash_strategic_participants || []).includes(p.name);
                    return (
                      <label key={p.name} className="approach-nash-check">
                        <input
                          type="checkbox"
                          checked={isStrategic}
                          onChange={(e) => {
                            const current = workingScenario.nash_strategic_participants || [];
                            const allNames = (workingYear.participants || []).map((x) => x.name);
                            const base = current.length === 0 ? allNames : current;
                            const next = e.target.checked
                              ? [...new Set([...base, p.name])]
                              : base.filter((n) => n !== p.name);
                            updateScenario({ nash_strategic_participants: next });
                          }}
                        />
                        <span>{p.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="builder-form-grid">
            <label>
              <span className="ekey">Year label <span className="field-flag required">required</span></span>
              <select
                value={String(year.year)}
                onChange={(event) => onSelectYear?.(event.target.value)}
              >
                {(scenario.years || []).map((item) => (
                  <option key={item.year} value={String(item.year)}>
                    {item.year}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ekey">Auction mode <span className="field-flag required">required</span></span>
              <select
                value={workingYear.auction_mode}
                onChange={(event) => updateYear({ auction_mode: event.target.value })}
              >
                <option value="explicit">explicit</option>
                <option value="derive_from_cap">derive_from_cap</option>
              </select>
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Total cap", () => openMarketSeriesEditor("total_cap"), true)}</span>
              {numInput(workingYear.total_cap, (value) => updateYear({ total_cap: value }), 1, 0)}
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Auction offered", () => openMarketSeriesEditor("auction_offered"), true)}</span>
              {numInput(workingYear.auction_offered || 0, (value) => updateYear({ auction_offered: value }), 1, 0)}
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Reserved allowances", () => openMarketSeriesEditor("reserved_allowances"), false, true)}</span>
              {numInput(workingYear.reserved_allowances || 0, (value) => updateYear({ reserved_allowances: value }), 1, 0)}
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Cancelled allowances", () => openMarketSeriesEditor("cancelled_allowances"), false, true)}</span>
              {numInput(workingYear.cancelled_allowances || 0, (value) => updateYear({ cancelled_allowances: value }), 1, 0)}
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Auction reserve price", () => openMarketSeriesEditor("auction_reserve_price"), false, true)}</span>
              {numInput(workingYear.auction_reserve_price || 0, (value) => updateYear({ auction_reserve_price: value }), 1, 0)}
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Minimum bid coverage", () => openMarketSeriesEditor("minimum_bid_coverage"), false, true)}</span>
              {numInput(workingYear.minimum_bid_coverage || 0, (value) => updateYear({ minimum_bid_coverage: value }), 0.05, 0)}
            </label>
            <label>
              <span className="ekey">Unsold treatment <span className="field-flag optional">optional</span></span>
              <select
                value={workingYear.unsold_treatment || "reserve"}
                onChange={(event) => updateYear({ unsold_treatment: event.target.value })}
              >
                <option value="reserve">reserve</option>
                <option value="cancel">cancel</option>
                <option value="carry_forward">carry_forward</option>
              </select>
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Price floor", () => openMarketSeriesEditor("price_lower_bound"), true)}</span>
              {numInput(workingYear.price_lower_bound, (value) => updateYear({ price_lower_bound: value }), 1, 0)}
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Price ceiling", () => openMarketSeriesEditor("price_upper_bound"), true)}</span>
              {numInput(workingYear.price_upper_bound, (value) => updateYear({ price_upper_bound: value }), 1, 0)}
            </label>
            <label>
              <span className="ekey">Banking allowed <span className="field-flag optional">optional</span></span>
              <select
                value={workingYear.banking_allowed ? "true" : "false"}
                onChange={(event) => updateYear({ banking_allowed: event.target.value === "true" })}
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
            <label>
              <span className="ekey">Borrowing allowed <span className="field-flag optional">optional</span></span>
              <select
                value={workingYear.borrowing_allowed ? "true" : "false"}
                onChange={(event) => updateYear({ borrowing_allowed: event.target.value === "true" })}
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Borrowing limit", () => openMarketSeriesEditor("borrowing_limit"), false, true)}</span>
              {numInput(workingYear.borrowing_limit || 0, (value) => updateYear({ borrowing_limit: value }), 1, 0)}
            </label>
            <label>
              <span className="ekey">Expectation rule <span className="field-flag optional">optional</span></span>
              <select
                value={workingYear.expectation_rule || "next_year_baseline"}
                onChange={(event) => updateYear({ expectation_rule: event.target.value })}
              >
                <option value="myopic">myopic</option>
                <option value="next_year_baseline">next_year_baseline</option>
                <option value="perfect_foresight">perfect_foresight</option>
                <option value="manual">manual</option>
              </select>
            </label>
            <label>
              <span className="ekey">{fieldWithPathButton("Manual expected price", () => openMarketSeriesEditor("manual_expected_price"), false, true)}</span>
              {numInput(workingYear.manual_expected_price || 0, (value) => updateYear({ manual_expected_price: value }), 1, 0)}
            </label>
          </div>
        </section>
      )}

      {activeStep === "participants" && (
        <section className="editor-section">
          <div className="editor-section-title">Participant builder</div>
          <div className="editor-field-legend">
            <span className="field-flag required">required</span>
            <span className="field-flag optional">optional</span>
          </div>
          <div className="builder-layout">
            <aside className="builder-sidebar">
              <div className="builder-sidebar-head">
                <div className="eyebrow">Participants</div>
                <button className="ghost-btn on" type="button" onClick={addParticipant}>Add</button>
              </div>
              <div className="builder-template-box">
                <div className="eyebrow">Add participant from template</div>
                <select
                  value={selectedParticipantTemplate}
                  onChange={(event) => setSelectedParticipantTemplate(event.target.value)}
                >
                  <option value="steel_blast_furnace">Steel Blast Furnace</option>
                  <option value="steel_hydrogen_dri">Steel Hydrogen DRI</option>
                  <option value="coal_generator">Coal Generator</option>
                  <option value="renewable_generator">Renewable Generator</option>
                  <option value="cement_kiln">Cement Kiln</option>
                </select>
                <div className="editor-actions spread">
                  <button className="ghost-btn" type="button" onClick={() => applyParticipantTemplate(selectedParticipantTemplate, "add")}>
                    Add from template
                  </button>
                  <button
                    className="ghost-btn"
                    type="button"
                    disabled={!participant}
                    onClick={() => applyParticipantTemplate(selectedParticipantTemplate, "replace")}
                  >
                    Apply to selected
                  </button>
                </div>
              </div>
              <div className="builder-list">
                {(workingYear.participants || []).map((item, index) => (
                  <button
                    key={`${item.name}-${index}`}
                    type="button"
                    className={"builder-list-item " + (selectedParticipantIndex === index ? "on" : "")}
                    onClick={() => {
                      setSelectedParticipantIndex(index);
                      setSelectedTechnologyIndex(0);
                    }}
                  >
                    <span>{item.name || `Participant ${index + 1}`}</span>
                    <span className="builder-item-meta">{item.sector || "Other"}</span>
                  </button>
                ))}
                {!(workingYear.participants || []).length && (
                  <div className="builder-empty">No participants yet. Add one to start building.</div>
                )}
              </div>
            </aside>

            <div className="builder-main">
              {participant ? (
                <>
                  <div className="builder-card">
                    <div className="builder-card-head">
                      <div>
                        <div className="eyebrow">Selected participant</div>
                        <h4>{participant.name || "Unnamed participant"}</h4>
                      </div>
                      <div className="editor-actions">
                        <button className="ghost-btn" type="button" onClick={() => duplicateParticipant(selectedParticipantIndex)}>Duplicate</button>
                        <button className="ghost-btn danger-btn" type="button" onClick={() => removeParticipant(selectedParticipantIndex)}>Remove</button>
                      </div>
                    </div>
                    <div className="builder-form-grid">
                      <label>
                        <span className="ekey">Participant name <span className="field-flag required">required</span></span>
                        <input
                          className="text"
                          value={participant.name}
                          onChange={(event) => updateParticipant(selectedParticipantIndex, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span className="ekey">Sector <span className="field-flag optional">optional</span></span>
                        <select
                          value={participant.sector || "Other"}
                          onChange={(event) => updateParticipant(selectedParticipantIndex, { sector: event.target.value })}
                        >
                          <option value="Industry">Industry</option>
                          <option value="Power">Power</option>
                          <option value="Other">Other</option>
                        </select>
                      </label>
                      <label>
                        <span className="ekey">{fieldWithPathButton("Initial emissions", () => openParticipantSeriesEditor("initial_emissions"), true)}</span>
                        {numInput(participant.initial_emissions, (value) => updateParticipant(selectedParticipantIndex, { initial_emissions: value }), 1, 0)}
                      </label>
                      <label>
                        <span className="ekey">{fieldWithPathButton("Free allocation ratio", () => openParticipantSeriesEditor("free_allocation_ratio"), true)}</span>
                        {numInput(participant.free_allocation_ratio, (value) => updateParticipant(selectedParticipantIndex, { free_allocation_ratio: value }), 0.05, 0)}
                      </label>
                      <label>
                        <span className="ekey">{fieldWithPathButton("Penalty price", () => openParticipantSeriesEditor("penalty_price"), true)}</span>
                        {numInput(participant.penalty_price, (value) => updateParticipant(selectedParticipantIndex, { penalty_price: value }), 1, 0)}
                      </label>
                    </div>
                    {renderAbatementFields(
                      participant,
                      (patch) => updateParticipant(selectedParticipantIndex, patch),
                    )}
                  </div>

                  <div className="builder-card">
                    <div className="builder-card-head">
                      <div>
                        <div className="eyebrow">Technology options</div>
                        <h4>Alternative technologies for {participant.name}</h4>
                      </div>
                      <div className="editor-actions">
                        <button className="ghost-btn on" type="button" onClick={() => addTechnologyOption(selectedParticipantIndex)}>Add technology</button>
                        <button className="ghost-btn" type="button" onClick={() => setWizardOpen((value) => !value)}>
                          {wizardOpen ? "Hide transition wizard" : "Open transition wizard"}
                        </button>
                        <button className="ghost-btn" type="button" onClick={() => buildTechnologyPathway(selectedParticipantIndex)}>
                          Quick pathway
                        </button>
                      </div>
                    </div>
                    <p className="muted">
                      If technology options are added, the model chooses the lowest-cost technology in equilibrium.
                    </p>
                    {wizardOpen && participant ? (
                      <div className="builder-wizard">
                        <div className="builder-card-subhead compact">
                          <div>
                            <div className="eyebrow">Transition wizard</div>
                            <div className="muted">Choose the incumbent archetype, select replacement technologies, preview the pathway, then apply it.</div>
                          </div>
                        </div>
                        <div className="builder-form-grid">
                          <label>
                            <span className="ekey">Incumbent archetype</span>
                            <select value={wizardArchetype} onChange={(event) => setWizardArchetype(event.target.value)}>
                              {Object.entries(wizardArchetypes).map(([id, item]) => (
                                <option key={id} value={id}>{item.label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span className="ekey">Transition mode</span>
                            <select value={wizardMode} onChange={(event) => setWizardMode(event.target.value)}>
                              <option value="conservative">conservative</option>
                              <option value="moderate">moderate</option>
                              <option value="aggressive">aggressive</option>
                            </select>
                          </label>
                          <div className="builder-span-2 builder-wizard-choice-box">
                            <span className="ekey">Replacement technologies</span>
                            <div className="builder-choice-grid">
                              {(wizardArchetypes[wizardArchetype]?.replacements || []).map((replacementId) => (
                                <label key={replacementId} className={"builder-choice-card " + (wizardReplacements.includes(replacementId) ? "on" : "")}>
                                  <input
                                    type="checkbox"
                                    checked={wizardReplacements.includes(replacementId)}
                                    onChange={() => toggleWizardReplacement(replacementId)}
                                  />
                                  <span>{replacementCatalog[replacementId]?.label || replacementId}</span>
                                </label>
                              ))}
                            </div>
                            <div className="muted">{wizardArchetypes[wizardArchetype]?.description}</div>
                          </div>
                        </div>
                        <div className="builder-wizard-preview">
                          <div className="builder-card-subhead compact">
                            <div>
                              <div className="eyebrow">Preview</div>
                              <div className="muted">This technology set will be written into the selected participant.</div>
                            </div>
                            <button
                              className="ghost-btn on"
                              type="button"
                              disabled={buildWizardPreview().length <= 1}
                              onClick={applyWizardPathway}
                            >
                              Apply pathway
                            </button>
                          </div>
                          <div className="builder-wizard-preview-grid">
                            {buildWizardPreview().map((option, index) => (
                              <div key={`${option.name}-${index}`} className="builder-preview-card">
                                <div className="builder-preview-head">
                                  <strong>{option.name}</strong>
                                  <span className={"builder-preview-tag " + (index === 0 ? "incumbent" : "transition")}>
                                    {index === 0 ? "Incumbent" : "Candidate"}
                                  </span>
                                </div>
                                <div className="builder-preview-metrics">
                                  <span>Emissions {fmt.num(option.initial_emissions || 0, 1)}</span>
                                  <span>Free ratio {fmt.num(option.free_allocation_ratio || 0, 2)}</span>
                                  <span>Fixed cost {fmt.num(option.fixed_cost || 0, 0)}</span>
                                  <span>Cap {fmt.num(option.max_activity_share ?? 1, 2)}</span>
                                  <span>MAC blocks {(option.mac_blocks || []).length}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="builder-tech-layout">
                      <div className="builder-tech-list">
                        {(participant.technology_options || []).map((option, index) => (
                          <button
                            key={`${option.name}-${index}`}
                            type="button"
                            className={"builder-list-item " + (selectedTechnologyIndex === index ? "on" : "")}
                            onClick={() => setSelectedTechnologyIndex(index)}
                          >
                            <span>{option.name || `Technology ${index + 1}`}</span>
                            <span className="builder-item-meta">{fmt.num(option.initial_emissions || 0, 0)} emissions</span>
                          </button>
                        ))}
                        {!(participant.technology_options || []).length && (
                          <div className="builder-empty">No technology options added. The participant uses its base configuration.</div>
                        )}
                      </div>
                      {selectedTechnology ? (
                        <div className="builder-tech-editor">
                          <div className="builder-card-subhead">
                            <div className="eyebrow">Selected technology</div>
                            <button
                              className="ghost-btn danger-btn"
                              type="button"
                              onClick={() => removeTechnologyOption(selectedParticipantIndex, selectedTechnologyIndex)}
                            >
                              Remove technology
                            </button>
                          </div>
                          <div className="builder-form-grid">
                            <label>
                              <span className="ekey">Technology name <span className="field-flag required">required</span></span>
                              <input
                                className="text"
                                value={selectedTechnology.name}
                                onChange={(event) => updateTechnologyOption(selectedParticipantIndex, selectedTechnologyIndex, { name: event.target.value })}
                              />
                            </label>
                            <label>
                              <span className="ekey">{fieldWithPathButton("Fixed cost", () => openTechnologySeriesEditor("fixed_cost"), false, true)}</span>
                              {numInput(selectedTechnology.fixed_cost || 0, (value) => updateTechnologyOption(selectedParticipantIndex, selectedTechnologyIndex, { fixed_cost: value }), 1, 0, fieldHelp.fixed_cost)}
                            </label>
                            <label>
                              <span className="ekey">{fieldWithPathButton("Adoption share cap", () => openTechnologySeriesEditor("max_activity_share"), false, true)}</span>
                              {numInput(selectedTechnology.max_activity_share ?? 1, (value) => updateTechnologyOption(selectedParticipantIndex, selectedTechnologyIndex, { max_activity_share: value }), 0.05, 0)}
                            </label>
                            <label>
                              <span className="ekey">{fieldWithPathButton("Technology emissions", () => openTechnologySeriesEditor("initial_emissions"), true)}</span>
                              {numInput(selectedTechnology.initial_emissions || 0, (value) => updateTechnologyOption(selectedParticipantIndex, selectedTechnologyIndex, { initial_emissions: value }), 1, 0)}
                            </label>
                            <label>
                              <span className="ekey">{fieldWithPathButton("Technology free ratio", () => openTechnologySeriesEditor("free_allocation_ratio"), true)}</span>
                              {numInput(selectedTechnology.free_allocation_ratio || 0, (value) => updateTechnologyOption(selectedParticipantIndex, selectedTechnologyIndex, { free_allocation_ratio: value }), 0.05, 0)}
                            </label>
                            <label>
                              <span className="ekey">{fieldWithPathButton("Technology penalty price", () => openTechnologySeriesEditor("penalty_price"), true)}</span>
                              {numInput(selectedTechnology.penalty_price || 0, (value) => updateTechnologyOption(selectedParticipantIndex, selectedTechnologyIndex, { penalty_price: value }), 1, 0)}
                            </label>
                          </div>
                          {renderAbatementFields(
                            selectedTechnology,
                            (patch) => updateTechnologyOption(selectedParticipantIndex, selectedTechnologyIndex, patch),
                            "Technology ",
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <div className="builder-empty large">Add a participant to start the step-by-step builder.</div>
              )}
            </div>
          </div>
        </section>
      )}

      {activeStep === "review" && (
        <section className="editor-section">
          <div className="editor-section-title">Scenario review</div>
          <div className="builder-review-grid">
            <div className="builder-review-card">
              <span className="ekey">Scenario</span>
              <strong>{workingScenario.name}</strong>
              <span className="muted">{workingScenario.description || "No description yet."}</span>
            </div>
            <div className="builder-review-card">
              <span className="ekey">Year</span>
              <strong>{workingYear.year}</strong>
              <span className="muted">Cap {fmt.num(workingYear.total_cap || 0, 0)} · Offered {fmt.num(workingYear.auction_offered || 0, 0)}</span>
            </div>
            <div className="builder-review-card">
              <span className="ekey">Participants</span>
              <strong>{(workingYear.participants || []).length}</strong>
              <span className="muted">
                {(workingYear.participants || []).reduce((sum, item) => sum + ((item.technology_options || []).length || 0), 0)} technology options configured
              </span>
            </div>
            <div className="builder-review-card">
              <span className="ekey">Intertemporal rules</span>
              <strong>{workingYear.banking_allowed ? "Banking on" : "Banking off"}</strong>
              <span className="muted">{workingYear.borrowing_allowed ? `Borrowing up to ${fmt.num(workingYear.borrowing_limit || 0, 0)}` : "Borrowing off"}</span>
              <span className="muted">Expectations: {workingYear.expectation_rule || "next_year_baseline"}{(workingYear.expectation_rule || "next_year_baseline") === "manual" ? ` (${fmt.price(workingYear.manual_expected_price || 0)})` : ""}</span>
            </div>
          </div>
          <div className="builder-review-table">
            <table className="pathway-table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Abatement model</th>
                  <th>MAC blocks</th>
                  <th>Technology options</th>
                </tr>
              </thead>
              <tbody>
                {(workingYear.participants || []).map((item, index) => (
                  <tr key={`${item.name}-${index}`}>
                    <td>{item.name}</td>
                    <td>{item.abatement_type}</td>
                    <td>{serializeMacBlocks(item) || "—"}</td>
                    <td>{(item.technology_options || []).map((option) => option.name).join(", ") || "Base only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {seriesEditor ? (
        <YearSeriesModal
          title={seriesEditor.title}
          field={seriesEditor.field}
          years={scenarioYearsWithDraft}
          values={seriesEditor.values}
          description={seriesEditor.description}
          onClose={() => setSeriesEditor(null)}
          onSave={applySeriesEdit}
          step={getSeriesFieldMeta(seriesEditor.field).step}
          min={getSeriesFieldMeta(seriesEditor.field).min}
          max={getSeriesFieldMeta(seriesEditor.field).max}
        />
      ) : null}
    </div>
  );
}
