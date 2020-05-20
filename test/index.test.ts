import engine from '@croct/plug-rule-engine/plugin';
import {ExtensionFactory} from '@croct/plug-rule-engine/extension';
import {PluginSdk} from '@croct/plug/plugin';
import {createLoggerMock, createTrackerMock} from './mocks';
import ExperimentsExtension, {Definitions} from '../src/extension';
import '../src/index';

jest.mock('@croct/plug-rule-engine/plugin', () => ({
    default: {
        extend: jest.fn(),
    },
}));

jest.mock('../src/extension', () => {
    const actual = jest.requireActual('../src/extension');

    return {
        ...actual,
        default: jest.fn(),
    };
});

describe('An experiments extension installer', () => {
    test('should register the plugin', () => {
        expect(engine.extend).toBeCalledWith('experiments', expect.anything());

        const [, factory]: [string, ExtensionFactory] = (engine.extend as jest.Mock).mock.calls[0];

        const tracker = createTrackerMock();
        const logger = createLoggerMock();

        const sdk: Partial<PluginSdk> = {
            tracker: tracker,
            getLogger: () => logger,
            getBrowserStorage: () => window.localStorage,
            getTabStorage: () => window.sessionStorage,
        };

        const definitions: Definitions = {
            foo: {
                type: 'ab',
                groups: ['a', 'b'],
            },
        };

        factory({options: definitions, sdk: sdk as PluginSdk});

        expect(ExperimentsExtension).toBeCalledTimes(1);

        expect(ExperimentsExtension).toBeCalledWith(
            definitions,
            tracker,
            window.localStorage,
            window.sessionStorage,
            logger,
        );
    });

    test.each<[any, string]>([
        [
            {
                foo: 1,
            },
            "Expected value of type object at path '/foo', actual integer.",
        ],
        [
            {
                foo: {
                    type: 'multivariate',
                    groups: ['a'],
                },
            },
            "Expected value of type array at path '/foo/groups/0', actual string.",
        ],
    ])('should reject definitions %p', (definitions: any, error: string) => {
        const [, factory]: [string, ExtensionFactory] = (engine.extend as jest.Mock).mock.calls[0];

        const sdk: Partial<PluginSdk> = {
            tracker: createTrackerMock(),
            getLogger: () => createLoggerMock(),
            getBrowserStorage: () => window.localStorage,
            getTabStorage: () => window.sessionStorage,
        };

        function create(): void {
            factory({options: definitions, sdk: sdk as PluginSdk});
        }

        expect(create).toThrow(error);
    });
});
