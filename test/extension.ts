import {ExternalEventPayload} from '@croct/plug/sdk/event';
import {Rule} from '@croct/plug-rule-engine/rule';
import {Predicate} from '@croct/plug-rule-engine/predicate';
import {Context} from '@croct/plug-rule-engine/context';
import ExperimentsExtension from '../src/extension';
import 'jest-extended';
import {createLoggerMock, createTrackerMock} from './mocks';

beforeEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
});

describe('An experiment extension', () => {
    test('should not provide a predicate if no test ID is specified', () => {
        const extension = new ExperimentsExtension(
            {
                fooTest: {
                    type: 'ab',
                    audience: 'foo',
                    groups: ['a', 'b'],
                },
            },
            createTrackerMock(),
            window.localStorage,
            window.sessionStorage,
            createLoggerMock(),
        );

        const rule: Rule = {
            name: 'foo',
            properties: {
                groupId: 'a',
            },
        };

        expect(extension.getPredicate(rule)).toBeNull();
    });

    test('should fail if the test ID is not a string', () => {
        const extensionFactory = ExperimentRunner.initialize({});

        const extension = extensionFactory.create(new MockContainer());

        const rule: Rule = {
            name: 'foo',
            properties: {
                testId: 1,
                groupId: 'a',
            },
        };

        function getPredicate(): void {
            extension.getPredicate(rule);
        }

        expect(getPredicate).toThrow(
            'Invalid test ID specified for rule "foo", expected string but got number.',
        );
    });

    test('should fail if the group is not a string', () => {
        const extensionFactory = ExperimentRunner.initialize({});

        const extension = extensionFactory.create(new MockContainer());

        const rule: Rule = {
            name: 'foo',
            properties: {
                testId: 'fooTest',
                groupId: 1,
            },
        };

        function getPredicate(): void {
            extension.getPredicate(rule);
        }

        expect(getPredicate).toThrow(
            'Invalid group ID specified for rule "foo", expected string but got number.',
        );
    });
});

describe('An A/B experiment runner', () => {
    test('should declare a variable for each test', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                groups: ['a', 'b'],
            },
            barTest: {
                type: 'ab',
                groups: ['c', 'd'],
            },
        });

        const container = new MockContainer();
        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        const extension = extensionFactory.create(container);
        const variables = extension.getVariables();

        expect(variables).toHaveProperty('fooTest');
        expect(variables).toHaveProperty('barTest');

        expect(await variables.fooTest()).toIncludeAnyMembers(['a', 'b']);
        expect(await variables.barTest()).toIncludeAnyMembers(['c', 'd']);
    });

    test('should provide a test group and audience predicate if an audience is specified', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'devs',
                groups: ['a', 'b'],
            },
        });

        const extension = extensionFactory.create(new MockContainer());

        const rule: Rule = {
            name: 'foo',
            properties: {
                testId: 'fooTest',
                groupId: 'a',
            },
        };

        const predicate = extension.getPredicate(rule);

        expect(predicate).not.toBeNull();

        const devContext = new Context({
            fooTest: (): Promise<any> => Promise.resolve(['a']),
            devs: (): Promise<any> => Promise.resolve(true),
        });

        await expect((predicate as Predicate).test(devContext)).resolves.toBe(true);

        const nonDevContext = new Context({
            fooTest: (): Promise<any> => Promise.resolve(['a']),
            devs: (): Promise<any> => Promise.resolve(false),
        });

        await expect((predicate as Predicate).test(nonDevContext)).resolves.toBe(false);
    });

    test('should only provide a test group predicate if no audience is specified', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                groups: ['a', 'b'],
            },
        });

        const extension = extensionFactory.create(new MockContainer());

        const rule: Rule = {
            name: 'foo',
            properties: {
                testId: 'fooTest',
                groupId: 'a',
            },
        };

        const predicate = extension.getPredicate(rule);

        expect(predicate).not.toBeNull();

        const context = new Context({fooTest: (): Promise<any> => Promise.resolve(['a'])});

        await expect((predicate as Predicate).test(context)).resolves.toBe(true);
    });

    test('should persist the assigned group in both application and session storage', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: ['a', 'b'],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);

        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();
        const tracker = container.getTracker();

        tracker.track = jest.fn().mockResolvedValue(undefined);

        const variables = extension.getVariables();
        const assignedGroup = await variables.fooTest();

        expect(assignedGroup).toEqual([JSON.parse(sessionStorage.getItem('fooTest') as string)]);
        expect(assignedGroup).toEqual([JSON.parse(applicationStorage.getItem('fooTest') as string)]);
    });

    test('should retrieve the previous assigned group from the session storage', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: ['a', 'b'],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();
        const tracker = container.getTracker();

        tracker.track = jest.fn().mockResolvedValue(undefined);

        // a new test group is assigned and stored in both session and application storage
        let variables = extension.getVariables();

        await variables.fooTest();

        const firstAssignedGroup = sessionStorage.getItem('fooTest');

        expect(firstAssignedGroup).toBeString();

        expect(applicationStorage.getItem('fooTest')).toBe(firstAssignedGroup);

        // no test group is assigned but retrieved from session storage
        variables = extension.getVariables();

        await variables.fooTest();

        expect(sessionStorage.getItem('fooTest')).toBe(firstAssignedGroup);
        expect(applicationStorage.getItem('fooTest')).toBe(firstAssignedGroup);

        sessionStorage.clear();
        applicationStorage.clear();

        expect(sessionStorage.getItem('fooTest')).toBeNull();
        expect(applicationStorage.getItem('fooTest')).toBeNull();

        // a new test group is assigned and stored in both session and application storage
        variables = extension.getVariables();

        await variables.fooTest();

        const secondAssignedGroup = sessionStorage.getItem('fooTest');

        expect(secondAssignedGroup).toBeString();

        expect(sessionStorage.getItem('fooTest')).toBe(secondAssignedGroup);
        expect(applicationStorage.getItem('fooTest')).toBe(secondAssignedGroup);

        const firstEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: JSON.parse(firstAssignedGroup as string),
        };

        const secondEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: JSON.parse(secondAssignedGroup as string),
        };

        await expect(tracker.track).toBeCalledTimes(2);
        await expect(tracker.track).toHaveBeenNthCalledWith(1, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(2, 'testGroupAssigned', secondEvent);
    });

    test('should use the application storage as a fallback to retrieve the previous assigned group', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: ['a', 'b'],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();
        const tracker = container.getTracker();

        tracker.track = jest.fn().mockResolvedValue(undefined);

        // a new test group is assigned and stored in both session and application storage
        let variables = extension.getVariables();
        let firstAssignedGroup = await variables.fooTest();

        expect(firstAssignedGroup).toEqual([JSON.parse(sessionStorage.getItem('fooTest') as string)]);
        expect(firstAssignedGroup).toEqual([JSON.parse(applicationStorage.getItem('fooTest') as string)]);

        sessionStorage.clear();

        expect(sessionStorage.getItem('fooTest')).toBeNull();
        expect(applicationStorage.getItem('fooTest')).not.toBeNull();

        // no test group is assigned but retrieved from session storage
        variables = extension.getVariables();
        firstAssignedGroup = await variables.fooTest();

        expect(firstAssignedGroup).toEqual([JSON.parse(sessionStorage.getItem('fooTest') as string)]);
        expect(firstAssignedGroup).toEqual([JSON.parse(applicationStorage.getItem('fooTest') as string)]);

        sessionStorage.clear();
        applicationStorage.clear();

        expect(sessionStorage.getItem('fooTest')).toBeNull();
        expect(applicationStorage.getItem('fooTest')).toBeNull();

        // a new test group is assigned and stored in both session and application storage
        variables = extension.getVariables();

        await variables.fooTest();

        const secondAssignedGroup = await variables.fooTest();

        expect(secondAssignedGroup).toEqual([JSON.parse(sessionStorage.getItem('fooTest') as string)]);
        expect(secondAssignedGroup).toEqual([JSON.parse(applicationStorage.getItem('fooTest') as string)]);

        const firstEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: firstAssignedGroup[0],
        };

        const secondEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: secondAssignedGroup[0],
        };

        await expect(tracker.track).toBeCalledTimes(3);
        await expect(tracker.track).toHaveBeenNthCalledWith(1, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(2, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(3, 'testGroupAssigned', secondEvent);
    });

    test('should assign groups evenly if no weights are specified', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: ['a', 'b'],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        let random = 0;
        jest.spyOn(window.Math, 'random').mockImplementation(() => random++ / 100);

        let firstGroup = 0;
        let secondGroup = 0;
        for (let i = 0; i < 100; i++) {
            sessionStorage.clear();
            applicationStorage.clear();

            const variables = extension.getVariables();
            const [assignedGroup] = await variables.fooTest();

            switch (assignedGroup) {
                case 'a':
                    firstGroup += 1;
                    break;

                case 'b':
                    secondGroup += 1;
                    break;

                default:
                    throw new Error(`Unexpected group: ${assignedGroup}.`);
            }
        }

        expect(firstGroup).toEqual(50);
        expect(secondGroup).toEqual(50);
    });

    test('should assign groups based on the weight specified', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: {
                    a: {weight: 80},
                    b: {weight: 20},
                },
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        let random = 0;
        jest.spyOn(window.Math, 'random').mockImplementation(() => random++ / 100);

        let firstGroup = 0;
        let secondGroup = 0;
        for (let i = 0; i < 100; i++) {
            sessionStorage.clear();
            applicationStorage.clear();

            const variables = extension.getVariables();
            const [assignedGroup] = await variables.fooTest();

            switch (assignedGroup) {
                case 'a':
                    firstGroup += 1;
                    break;

                case 'b':
                    secondGroup += 1;
                    break;

                default:
                    throw new Error(`Unexpected group: ${assignedGroup}.`);
            }
        }

        expect(firstGroup).toBe(80);
        expect(secondGroup).toBe(20);
    });

    test('should re-assign a test group if the stored value is not a string', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: ['a', 'b'],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();
        const tracker = container.getTracker();

        tracker.track = jest.fn().mockResolvedValue(undefined);

        let variables = extension.getVariables();
        const [firstAssignedGroup] = await variables.fooTest();

        expect(firstAssignedGroup).toBeString();

        expect(firstAssignedGroup).toBe(JSON.parse(sessionStorage.getItem('fooTest') as string));
        expect(firstAssignedGroup).toBe(JSON.parse(applicationStorage.getItem('fooTest') as string));

        sessionStorage.setItem('fooTest', '123');
        applicationStorage.setItem('fooTest', '123');

        // a new test group is assigned and stored in both session and application storage
        variables = extension.getVariables();
        const [secondAssignedGroup] = await variables.fooTest();

        expect(secondAssignedGroup).toBeString();

        expect(secondAssignedGroup).toBe(JSON.parse(sessionStorage.getItem('fooTest') as string));
        expect(secondAssignedGroup).toBe(JSON.parse(applicationStorage.getItem('fooTest') as string));

        const firstEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: firstAssignedGroup,
        };

        const secondEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: secondAssignedGroup,
        };

        await expect(tracker.track).toBeCalledTimes(2);
        await expect(tracker.track).toHaveBeenNthCalledWith(1, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(2, 'testGroupAssigned', secondEvent);
    });

    test('should re-assign a test group if the stored value is corrupted', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: ['a', 'b'],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        // a new test group is assigned and stored in both session and application storage
        let variables = extension.getVariables();
        const [firstAssignedGroup] = await variables.fooTest();

        expect(firstAssignedGroup).toBeString();

        expect(firstAssignedGroup).toBe(JSON.parse(applicationStorage.getItem('fooTest') as string));

        sessionStorage.setItem('fooTest', '"a');
        applicationStorage.setItem('fooTest', '"a');

        // a new test group is assigned and stored in both session and application storage
        variables = extension.getVariables();
        const [secondAssignedGroup] = await variables.fooTest();

        expect(secondAssignedGroup).toBeString();

        expect(secondAssignedGroup).toBe(JSON.parse(sessionStorage.getItem('fooTest') as string));
        expect(secondAssignedGroup).toBe(JSON.parse(applicationStorage.getItem('fooTest') as string));

        const firstEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: firstAssignedGroup,
        };

        const secondEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: secondAssignedGroup,
        };

        await expect(tracker.track).toBeCalledTimes(2);
        await expect(tracker.track).toHaveBeenNthCalledWith(1, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(2, 'testGroupAssigned', secondEvent);
    });

    test('should conditionally activate a test based on the traffic allocation specified', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: ['a', 'b'],
                traffic: 0.6,
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        let iteration = 0;
        let random1 = 0;
        let random2 = 0;
        jest.spyOn(window.Math, 'random').mockImplementation(() => {
            if (iteration < 120 && iteration++ % 2 === 0) {
                return random1++ / 100;
            }

            return random2++ / 60;
        });

        let noGroup = 0;
        let firstGroup = 0;
        let secondGroup = 0;
        for (let i = 0; i < 100; i++) {
            sessionStorage.clear();
            applicationStorage.clear();

            const variables = extension.getVariables();
            const [assignedGroup = null] = await variables.fooTest();

            switch (assignedGroup) {
                case 'a':
                    firstGroup += 1;
                    break;

                case 'b':
                    secondGroup += 1;
                    break;

                case null:
                    noGroup += 1;
                    break;

                default:
                    throw new Error(`Unexpected group: ${assignedGroup}.`);
            }
        }

        expect(noGroup).toEqual(40);
        expect(firstGroup).toEqual(30);
        expect(secondGroup).toEqual(30);
    });

    test('should log an error message if the "testGroupAssigned" event cannot be tracked', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'ab',
                audience: 'foo',
                groups: ['a', 'b'],
            },
        });

        const container = new MockContainer();
        const logger = container.getLogger();
        const tracker = container.getTracker();

        tracker.track = jest.fn().mockRejectedValue(new Error('Tracking error.'));

        const extension = extensionFactory.create(container);

        const variables = extension.getVariables();
        const [assignedGroup] = await variables.fooTest();

        await expect(tracker.track).toBeCalledTimes(1);

        expect(logger.error).toBeCalledWith(
            `Failed to track group assignment "${assignedGroup}" for test "fooTest".`,
        );
    });
});

describe('A multivariate experiment runner', () => {
    test('should declare a variable for each test', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                groups: [['a'], ['b']],
            },
            barTest: {
                type: 'multivariate',
                groups: [['c'], ['d']],
            },
        });

        const container = new MockContainer();
        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        const extension = extensionFactory.create(container);
        const variables = extension.getVariables();

        expect(variables).toHaveProperty('fooTest');
        expect(variables).toHaveProperty('barTest');

        const fooGroups = await variables.fooTest();

        expect(fooGroups).toIncludeAnyMembers(['a', 'b']);
        expect(fooGroups).toContain('a|b');

        const barGroups = await variables.barTest();

        expect(barGroups).toIncludeAnyMembers(['c', 'd']);
        expect(barGroups).toContain('c|d');
    });

    test('should provide a test group and audience predicate if an audience is specified', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'devs',
                groups: [['a'], ['b']],
            },
        });

        const extension = extensionFactory.create(new MockContainer());

        const rule: Rule = {
            name: 'foo',
            properties: {
                testId: 'fooTest',
                groupId: 'a',
            },
        };

        const predicate = extension.getPredicate(rule);

        expect(predicate).not.toBeNull();

        const devContext = new Context({
            fooTest: (): Promise<any> => Promise.resolve(['a|b', 'a', 'b']),
            devs: (): Promise<any> => Promise.resolve(true),
        });

        await expect((predicate as Predicate).test(devContext)).resolves.toBe(true);

        const nonDevContext = new Context({
            fooTest: (): Promise<any> => Promise.resolve(['a']),
            devs: (): Promise<any> => Promise.resolve(false),
        });

        await expect((predicate as Predicate).test(nonDevContext)).resolves.toBe(false);
    });

    test('should only provide a test group predicate if no audience is specified', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                groups: [['a'], ['b']],
            },
        });

        const extension = extensionFactory.create(new MockContainer());

        const rule: Rule = {
            name: 'foo',
            properties: {
                testId: 'fooTest',
                groupId: 'a',
            },
        };

        const predicate = extension.getPredicate(rule);

        expect(predicate).not.toBeNull();

        const context = new Context({fooTest: (): Promise<any> => Promise.resolve(['a|b', 'a', 'b'])});

        await expect((predicate as Predicate).test(context)).resolves.toBe(true);
    });

    test('should persist the assigned group in both application and session storage', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'foo',
                groups: [['a1', 'a2'], ['b1', 'b2']],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        const variables = extension.getVariables();
        const assignedGroups = await variables.fooTest();

        expect(assignedGroups).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(assignedGroups).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );
    });

    test('should retrieve the previous assigned groups from the session storage', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'foo',
                groups: [['a1', 'a2'], ['b1', 'b2']],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        // a new test group is assigned and stored in both session and application storage
        let variables = extension.getVariables();
        let firstAssignedGroup = await variables.fooTest();

        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        // no test group is assigned but retrieved from session storage
        variables = extension.getVariables();
        firstAssignedGroup = await variables.fooTest();

        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        sessionStorage.clear();
        applicationStorage.clear();

        expect(sessionStorage.getItem('fooTest')).toBeNull();
        expect(applicationStorage.getItem('fooTest')).toBeNull();

        // a new test group is assigned and stored in both session and application storage
        variables = extension.getVariables();
        const secondAssignedGroup = await variables.fooTest();

        expect(secondAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(secondAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        const firstEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: firstAssignedGroup
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|'),
        };

        const secondEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: secondAssignedGroup
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|'),
        };

        await expect(tracker.track).toBeCalledTimes(2);
        await expect(tracker.track).toHaveBeenNthCalledWith(1, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(2, 'testGroupAssigned', secondEvent);
    });

    test('should use the application storage as a fallback to retrieve the previous assigned group', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'foo',
                groups: [['a1', 'a2'], ['b1', 'b2']],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        // first time, test group is assigned and result is saved in session and application storage
        // a new test group is assigned and stored in both session and application storage
        let variables = extension.getVariables();
        let firstAssignedGroup = await variables.fooTest();

        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        // Session storage is cleared
        sessionStorage.clear();

        expect(sessionStorage.getItem('fooTest')).toBeNull();
        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        // second time, test group is not assigned and result is retrieved from application storage
        variables = extension.getVariables();
        firstAssignedGroup = await variables.fooTest();

        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        // Session and application storage are cleared
        sessionStorage.clear();
        applicationStorage.clear();

        expect(sessionStorage.getItem('fooTest')).toBeNull();
        expect(applicationStorage.getItem('fooTest')).toBeNull();

        // third time, test group is assigned and result is saved in session and application storage
        variables = extension.getVariables();
        const secondAssignedGroup = await variables.fooTest();

        expect(secondAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(secondAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        const firstEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: firstAssignedGroup
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|'),
        };

        const secondEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: secondAssignedGroup
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|'),
        };

        await expect(tracker.track).toBeCalledTimes(3);
        await expect(tracker.track).toHaveBeenNthCalledWith(1, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(2, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(3, 'testGroupAssigned', secondEvent);
    });

    test('should re-assign a test group if the stored value is not an array', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'foo',
                groups: [['a1', 'a2'], ['b1', 'b2']],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        // a new test group is assigned and stored in both session and application storage
        let variables = extension.getVariables();
        const firstAssignedGroup = await variables.fooTest();

        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        sessionStorage.setItem('fooTest', '123');
        applicationStorage.setItem('fooTest', '123');

        // a new test group is assigned and stored in both session and application storage
        variables = extension.getVariables();
        const secondAssignedGroup = await variables.fooTest();

        expect(secondAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(secondAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        const firstEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: firstAssignedGroup
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|'),
        };

        const secondEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: secondAssignedGroup
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|'),
        };

        await expect(tracker.track).toBeCalledTimes(2);
        await expect(tracker.track).toHaveBeenNthCalledWith(1, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(2, 'testGroupAssigned', secondEvent);
    });

    test('should re-assign a test group if the stored value is corrupted', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'foo',
                groups: [['a1', 'a2'], ['b1', 'b2']],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);
        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockResolvedValue(undefined);

        // a new test group is assigned and stored in both session and application storage
        let variables = extension.getVariables();
        const firstAssignedGroup = await variables.fooTest();

        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(firstAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        sessionStorage.setItem('fooTest', '"a');
        applicationStorage.setItem('fooTest', '"a');

        // a new test group is assigned and stored in both session and application storage
        variables = extension.getVariables();
        const secondAssignedGroup = await variables.fooTest();

        expect(secondAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(sessionStorage.getItem('fooTest') as string)),
        );
        expect(secondAssignedGroup).toEqual(
            expect.arrayContaining(JSON.parse(applicationStorage.getItem('fooTest') as string)),
        );

        const firstEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: firstAssignedGroup
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|'),
        };

        const secondEvent: ExternalEventPayload<'testGroupAssigned'> = {
            testId: 'fooTest',
            groupId: secondAssignedGroup
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|'),
        };

        await expect(tracker.track).toBeCalledTimes(2);
        await expect(tracker.track).toHaveBeenNthCalledWith(1, 'testGroupAssigned', firstEvent);
        await expect(tracker.track).toHaveBeenNthCalledWith(2, 'testGroupAssigned', secondEvent);
    });

    test('should assign groups evenly', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'foo',
                groups: [['a1', 'a2'], ['b1', 'b2']],
            },
        });

        const container = new MockContainer();
        const extension = extensionFactory.create(container);

        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();
        const tracker = container.getTracker();

        tracker.track = jest.fn().mockResolvedValue(undefined);

        let random = 0;
        jest.spyOn(window.Math, 'random').mockImplementation(() => random++ / 100);

        let A1B1 = 0;
        let A1B2 = 0;
        let A2B1 = 0;
        let A2B2 = 0;
        for (let i = 0; i < 100; i++) {
            sessionStorage.clear();
            applicationStorage.clear();

            const variables = extension.getVariables();
            const assignedGroups = await variables.fooTest();
            const assignedCombination = assignedGroups
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|');

            switch (assignedCombination) {
                case 'a1|b1':
                    A1B1 += 1;
                    break;

                case 'a1|b2':
                    A1B2 += 1;
                    break;

                case 'a2|b1':
                    A2B1 += 1;
                    break;

                case 'a2|b2':
                    A2B2 += 1;
                    break;

                default:
                    throw new Error(`Unexpected group: ${assignedCombination}.`);
            }
        }

        expect(A1B1).toBe(25);
        expect(A1B2).toBe(25);
        expect(A2B1).toBe(25);
        expect(A2B2).toBe(25);
    });

    test('should conditionally activate a test based on the traffic allocation specified', async () => {
        const container = new MockContainer();
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'foo',
                groups: [['a1', 'a2'], ['b1', 'b2']],
                traffic: 0.6,
            },
        });

        const extension = extensionFactory.create(container);

        const sessionStorage = container.getSessionStorage();
        const applicationStorage = container.getApplicationStorage();
        const tracker = container.getTracker();

        tracker.track = jest.fn().mockResolvedValue(undefined);

        let iteration = 0;
        let random1 = 0;
        let random2 = 0;
        jest.spyOn(window.Math, 'random').mockImplementation(() => {
            if (iteration < 120 && iteration++ % 2 !== 0) {
                return (random2++ % 60) / 60;
            }

            return random1++ / 100;
        });

        let noGroup = 0;
        let A1B1 = 0;
        let A1B2 = 0;
        let A2B1 = 0;
        let A2B2 = 0;
        for (let i = 0; i < 100; i++) {
            sessionStorage.clear();
            applicationStorage.clear();

            const variables = extension.getVariables();
            const assignedGroups = await variables.fooTest();
            const assignedCombination = assignedGroups
                .filter((group: string) => group.indexOf('|') < 0)
                .join('|');

            switch (assignedCombination) {
                case '':
                    noGroup++;
                    break;

                case 'a1|b1':
                    A1B1++;
                    break;

                case 'a1|b2':
                    A1B2++;
                    break;

                case 'a2|b1':
                    A2B1++;
                    break;

                case 'a2|b2':
                    A2B2++;
                    break;

                default:
                    throw new Error(`Unexpected group: ${assignedCombination}.`);
            }
        }

        expect(noGroup).toBe(40);
        expect(A1B1).toBe(15);
        expect(A1B2).toBe(15);
        expect(A2B1).toBe(15);
        expect(A2B2).toBe(15);
    });

    test('should log an error message if the "testGroupAssigned" event cannot be tracked', async () => {
        const extensionFactory = ExperimentRunner.initialize({
            fooTest: {
                type: 'multivariate',
                audience: 'foo',
                groups: [['a1', 'a2'], ['b1', 'b2']],
            },
        });

        const container = new MockContainer();
        const logger = container.getLogger();

        const tracker = container.getTracker();
        tracker.track = jest.fn().mockRejectedValue(new Error('Tracking error.'));

        const extension = extensionFactory.create(container);

        const variables = extension.getVariables();
        const assignedGroups = await variables.fooTest();
        const assignedCombination = assignedGroups
            .filter((group: string) => group.indexOf('|') < 0)
            .join('|');

        await expect(tracker.track).toBeCalledTimes(1);

        expect(logger.error).toBeCalledWith(
            `Failed to track group assignment "${assignedCombination}" for test "fooTest".`,
        );
    });
});
