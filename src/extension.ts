import {Logger} from '@croct/plug/sdk';
import {Tracker} from '@croct/plug/sdk/tracking';
import {ExternalEventPayload} from '@croct/plug/sdk/event';
import {ArrayType, NumberType, ObjectType, StringType, UnionType, formatCause} from '@croct/plug/sdk/validation';
import {And, Contains, Predicate, Variable} from '@croct/plug-rule-engine/predicate';
import {VariableMap} from '@croct/plug-rule-engine/context';
import {Extension} from '@croct/plug-rule-engine/extension';
import {Rule} from '@croct/plug-rule-engine/rule';

type AbCustomSplitGroups = {[key: string]: {weight: number}};

type AbEvenlySplitGroups = string[];

type AbTestGroups = AbCustomSplitGroups | AbEvenlySplitGroups;

export type AbExperiment = {
    type: 'ab',
    traffic?: number,
    audience?: string,
    groups: AbTestGroups,
};

export type MultivariateExperiment = {
    type: 'multivariate',
    traffic?: number,
    audience?: string,
    groups: string[][],
};

export type Experiment = AbExperiment | MultivariateExperiment;

export type ExperimentProperties = {
    testId: string,
    groupId: string,
}

const propertiesSchema = new ObjectType({
    required: ['testId', 'groupId'],
    properties: {
        testId: new StringType({minLength: 1}),
        groupId: new StringType({minLength: 1}),
    },
});

export type ExperimentDefinitions = {[key: string]: Experiment};

const abTestSchema = new ObjectType({
    required: ['groups'],
    properties: {
        groups: new UnionType(
            new ArrayType({
                minItems: 1,
                items: new StringType({
                    minLength: 1,
                }),
            }),
            new ObjectType({
                minProperties: 1,
                additionalProperties: new ObjectType({
                    required: ['weight'],
                    properties: {
                        weight: new NumberType({
                            minimum: 0,
                            maximum: 1,
                        }),
                    },
                }),
            }),
        ),
    },
});

const multivariateTestSchema = new ObjectType({
    required: ['groups'],
    properties: {
        groups: new ArrayType({
            minItems: 1,
            items: new ArrayType({
                minItems: 1,
                items: new StringType({
                    minLength: 1,
                }),
            }),
        }),
    },
});

export const definitionsSchema = new ObjectType({
    additionalProperties: new ObjectType({
        required: ['type'],
        additionalProperties: true,
        properties: {
            type: new StringType({
                enumeration: ['ab', 'multivariate'],
            }),
            traffic: new NumberType({
                minimum: 0,
                maximum: 1,
            }),
            audience: new StringType({minLength: 1}),
        },
        subtypes: {
            discriminator: 'type',
            schemas: {
                ab: abTestSchema,
                multivariate: multivariateTestSchema,
            },
        },
    }),
});

export default class ExperimentsExtension implements Extension {
    private readonly experiments: ExperimentDefinitions;

    private readonly tracker: Tracker;

    private readonly browserStorage: Storage;

    private readonly tabStorage: Storage;

    private readonly logger: Logger;

    public constructor(
        experiments: ExperimentDefinitions,
        tracker: Tracker,
        browserStorage: Storage,
        tagStorage: Storage,
        logger: Logger,
    ) {
        this.experiments = experiments;
        this.tracker = tracker;
        this.browserStorage = browserStorage;
        this.tabStorage = tagStorage;
        this.logger = logger;
    }

    public getVariables(): VariableMap {
        const variables: VariableMap = {};

        for (const testId of Object.keys(this.experiments)) {
            variables[testId] = (): Promise<string[]> => Promise.resolve(this.assignGroup(testId));
        }

        return variables;
    }

    public getPredicate({name, properties: {experiment}}: Rule): Predicate|null {
        if (experiment === undefined) {
            return null;
        }

        try {
            propertiesSchema.validate(experiment);
        } catch (error) {
            this.logger.error(`Invalid experiment properties specified for rule "${name}": ${formatCause(error)}`);

            return null;
        }

        const {testId, groupId} = experiment as ExperimentProperties;

        return this.getGroupCondition(testId, groupId);
    }

    private getGroupCondition(testId: string, groupId: string): Predicate {
        const groupCondition = new Contains(testId, groupId);

        const {audience} = this.experiments[testId];

        if (audience === undefined) {
            return groupCondition;
        }

        return new And(groupCondition, new Variable(audience));
    }

    private assignGroup(testId: string): string[] {
        const experiment = this.experiments[testId];

        switch (experiment.type) {
            case 'ab': {
                const group = this.assignAbGroup(testId, experiment);

                if (group !== null) {
                    return [group];
                }

                return [];
            }

            case 'multivariate': {
                const groups = this.assignMultivariateGroups(testId, experiment);

                return [groups.join('|'), ...groups];
            }
        }
    }

    private assignAbGroup(testId: string, experiment: AbExperiment): string|null {
        let previousGroupId: string|null = null;

        let serializedGroupId = this.tabStorage.getItem(testId);

        if (serializedGroupId !== null) {
            previousGroupId = deserializeGroup(serializedGroupId);

            if (previousGroupId !== null) {
                return previousGroupId === '' ? null : previousGroupId;
            }
        }

        serializedGroupId = this.browserStorage.getItem(testId);

        if (serializedGroupId !== null) {
            previousGroupId = deserializeGroup(serializedGroupId);

            if (previousGroupId !== null) {
                this.tabStorage.setItem(testId, JSON.stringify(previousGroupId));

                if (previousGroupId !== '') {
                    this.trackAssignedAbGroup(testId, previousGroupId);
                }

                return previousGroupId === '' ? null : previousGroupId;
            }
        }

        this.logger.debug(`No group previously assigned to A/B test "${testId}"`);

        const groupId = this.selectAbGroup(experiment);

        serializedGroupId = JSON.stringify(groupId ?? '');

        this.tabStorage.setItem(testId, serializedGroupId);
        this.browserStorage.setItem(testId, serializedGroupId);

        if (groupId !== null) {
            this.trackAssignedAbGroup(testId, groupId);
        }

        this.logger.debug(
            groupId === null
                ? `Traffic ineligible for A/B test "${testId}".`
                : `Group "${groupId}" assigned to A/B test "${testId}".`,
        );

        return groupId;
    }

    private trackAssignedAbGroup(testId: string, groupId: string): void {
        const event: ExternalEventPayload<'testGroupAssigned'> = {
            testId: testId,
            groupId: groupId,
        };

        this.tracker.track('testGroupAssigned', event).catch(() => {
            this.logger.error(
                `Failed to track group assignment "${event.groupId}" for test "${event.testId}".`,
            );
        });
    }

    private selectAbGroup({traffic, groups}: AbExperiment): string|null {
        if (traffic !== undefined && Math.random() >= traffic) {
            return null;
        }

        if (Array.isArray(groups)) {
            // Evenly split groups
            return groups[Math.floor(Math.random() * groups.length)];
        }

        // Weighted groups
        let sum = 0;
        const choices: {group: string, weight: number}[] = [];
        for (const [name, {weight}] of Object.entries(groups)) {
            sum += weight;
            choices.push({group: name, weight: weight});
        }

        let random = Math.floor(Math.random() * sum);

        for (let index = 0; index < choices.length - 1; index++) {
            random -= choices[index].weight;

            if (random < 0) {
                return choices[index].group;
            }
        }

        return choices[choices.length - 1].group;
    }

    private assignMultivariateGroups(testId: string, experiment: MultivariateExperiment): string[] {
        let previousGroupIds: string[]|null = null;
        let serializedGroupIds = this.tabStorage.getItem(testId);

        if (serializedGroupIds !== null) {
            previousGroupIds = deserializeGroups(serializedGroupIds);

            if (previousGroupIds !== null) {
                return previousGroupIds;
            }
        }

        serializedGroupIds = this.browserStorage.getItem(testId);

        if (serializedGroupIds !== null) {
            previousGroupIds = deserializeGroups(serializedGroupIds);

            if (previousGroupIds !== null) {
                this.tabStorage.setItem(testId, JSON.stringify(previousGroupIds));

                if (previousGroupIds.length > 0) {
                    this.trackAssignedMultivariateGroup(testId, previousGroupIds);
                }

                return previousGroupIds;
            }
        }

        this.logger.debug(`No group previously assigned to multivariate test "${testId}"`);

        const groupIds = this.selectMultivariateGroups(experiment);
        serializedGroupIds = JSON.stringify(groupIds);

        this.tabStorage.setItem(testId, serializedGroupIds);
        this.browserStorage.setItem(testId, serializedGroupIds);

        if (groupIds.length > 0) {
            this.trackAssignedMultivariateGroup(testId, groupIds);
        }

        this.logger.debug(
            groupIds.length === 0
                ? `Traffic ineligible for multivariate test "${testId}".`
                : `Groups ["${groupIds.join('", "')}"] assigned to multivariate test "${testId}".`,
        );

        return groupIds;
    }

    private trackAssignedMultivariateGroup(testId: string, groupIds: string[]): void {
        const event: ExternalEventPayload<'testGroupAssigned'> = {
            testId: testId,
            groupId: groupIds.join('|'),
        };

        this.tracker.track('testGroupAssigned', event).catch(() => {
            this.logger.error(
                `Failed to track group assignment "${event.groupId}" for test "${event.testId}".`,
            );
        });
    }

    private selectMultivariateGroups({traffic, groups}: MultivariateExperiment): string[] {
        if (traffic !== undefined && Math.random() >= traffic) {
            return [];
        }

        const combinationCount = groups.reduce((count, group) => count * group.length, 1);

        let combinationIndex = Math.floor(Math.random() * combinationCount);

        const combination: string[] = [];
        for (let index = groups.length - 1; index >= 0; index--) {
            const currentGroupLength = groups[index].length;
            const currentVariation = groups[index][combinationIndex % currentGroupLength];

            combination.unshift(currentVariation);

            combinationIndex = Math.floor(combinationIndex / currentGroupLength);
        }

        return combination;
    }
}

function deserializeGroup(json: string): string|null {
    let value;

    try {
        value = JSON.parse(json);
    } catch {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    return null;
}

function deserializeGroups(json: string): string[]|null {
    let value;

    try {
        value = JSON.parse(json);
    } catch {
        return null;
    }

    if (!Array.isArray(value)) {
        return null;
    }

    return value.filter(element => typeof element === 'string');
}
