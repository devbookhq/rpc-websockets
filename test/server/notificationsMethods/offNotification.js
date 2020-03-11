const expect = require("chai").expect
const spy = require("chai").spy
const INVALID_VALUES = require("../../_invalidValues")
const ExternallyResolvablePromise = require("../../__helpers__/ExternallyResolvalePromise")

const noop = () => {}

module.exports = ({runWebSocketServer, connectTo}) =>
{
    /**
     * Prepare client and server to work together
     * @returns {Promise}
     */
    async function prepareClientAndServer({clientOptions = {}} = {})
    {
        const server = await runWebSocketServer()
        const serverGotConnection = new ExternallyResolvablePromise()
        server.on("RPCConnection", serverGotConnection.resolve)
        const client = connectTo({server, ...clientOptions})
        return Promise
            .all([serverGotConnection, client])
            .then(([, client]) => ({server, client}))
    }

    describe(".offNotification()", () =>
    {
        it("Expects notification name to be passed in first argument and handler to be passed in second", async () =>
        {
            const {server, client} = await prepareClientAndServer()
            const NOTIFICATION_NAME = "testNotification"
            const notificationHandler = spy(noop)
            server.onNotification(NOTIFICATION_NAME, notificationHandler)
            await new Promise((resolve) =>
            {
                server.offNotification(NOTIFICATION_NAME, notificationHandler)
                server.onNotification(NOTIFICATION_NAME, resolve)
                client.send(JSON.stringify({
                    jsonrpc: "2.0",
                    method: NOTIFICATION_NAME
                }))
            })
            expect(notificationHandler).to.not.have.been.called()
        })

        it("Allows to pass multiple notification names and handlers as object in first argument", async () =>
        {
            const {server, client} = await prepareClientAndServer()
            const notifications = {
                notification1: spy(noop),
                notification2: spy(noop)
            }
            server.onNotification(notifications)
            server.offNotification(notifications)
            // Wait till all notifications will be received by server:
            await Promise.all(
                Object.keys(notifications).map((name) => (
                    new Promise((resolve) =>
                    {
                        server.onNotification(name, resolve)
                        client.send(JSON.stringify({
                            jsonrpc: "2.0",
                            method: name
                        }))
                    })
                ))
            )
            const handlers = Object.values(notifications)
            handlers.every((handler) => expect(handler).to.not.have.been.called())
        })

        it("Throws an error if notification name is not a string (except if object passed)", async () =>
        {
            const server = await runWebSocketServer()
            const invalidValues = INVALID_VALUES.STRING.filter(
                // Do not include in this list objects (because they are valid):
                (value) => !value || Array.isArray(value) || typeof value !== "object"
            )
            for (const invalidValue of invalidValues)
            {
                expect(() => server.offNotification(invalidValue, noop)).to.throw(TypeError, "Subsciptions is not a mapping of names to handlers")
            }
        })

        it("Throws an error if notification name is empty", async () =>
        {
            const server = await runWebSocketServer()
            const invalidValues = INVALID_VALUES.STRING__FILLED
            for (const invalidValue of invalidValues)
            {
                expect(() => server.offNotification(invalidValue, noop)).to.throw(Error, "Given notification name is empty")
                expect(() => server.offNotification({[invalidValue]: noop})).to.throw(Error, "Given notification name is empty")
            }
        })

        it("Throws an error if notification name starts with 'rpc.'", async () =>
        {
            const server = await runWebSocketServer()
            const invalidValues = ["rpc.notification", "rpc."]
            const ERROR_TEXT = "Notifications with prefix \"rpc.\" is for internal usage only"
            for (const invalidValue of invalidValues)
            {
                expect(() => server.offNotification(invalidValue, noop)).to.throw(Error, ERROR_TEXT)
                expect(() => server.offNotification({[invalidValue]: noop})).to.throw(Error, ERROR_TEXT)
            }
        })

        it("Throws an error if invalid notification handler passed", async () =>
        {
            const server = await runWebSocketServer()
            const invalidValues = INVALID_VALUES.FUNCTION
            for (const invalidValue of invalidValues)
            {
                // if two arguments passed:
                expect(() => server.offNotification("some_notification", invalidValue))
                    .to
                    .throw(
                        TypeError,
                        `Expected function as notification handler, got ${invalidValue === null ? "null" : typeof invalidValue}`
                    )
                // If one argument passed:
                expect(() => server.offNotification({"some_notification": invalidValue}))
                    .to
                    .throw(
                        TypeError,
                        `Expected function as notification handler, got ${invalidValue === null ? "null" : typeof invalidValue}`
                    )
            }
        })

        it("Allows to remove multiple handlers of one notification", async () =>
        {
            const {server, client} = await prepareClientAndServer()
            const NOTIFICATION = "some_notification"
            const notificationTrackers = [spy(noop), spy(noop), spy(noop)]
            const notificationsToRemove = notificationTrackers.slice(0, -1)
            const notificationsToCall = notificationTrackers.slice(-1)
            // Register all notification handlers:
            notificationTrackers.forEach(server.onNotification.bind(server, NOTIFICATION))
            // Unregister some notification handlers:
            notificationsToRemove.forEach(server.offNotification.bind(server, NOTIFICATION))
            // Test which notification handlers will be invoked and which are not:
            await new Promise((resolve) =>
            {
                server.onNotification(NOTIFICATION, resolve)
                client.send(JSON.stringify({
                    jsonrpc: "2.0",
                    method: NOTIFICATION
                }))
            })
            notificationsToRemove.every((handler) => expect(handler).to.not.have.been.called())
            notificationsToCall.every((handler) => expect(handler).to.have.been.called())
        })

        it("Does nothing if given notification name not exists", async () =>
        {
            const server = await runWebSocketServer()
            expect(() => server.offNotification("non-existing-notification", noop)).to.not.throw()
            expect(() => server.offNotification({nonExistingNotification: noop})).to.not.throw()
        })

        it("Does nothing if given notification handler not exists", async () =>
        {
            const server = await runWebSocketServer()
            const notification = "some_notification"
            server.onNotification(notification, noop)
            const nonExistingHandler = () => {}
            expect(() => server.offNotification(notification, nonExistingHandler)).to.not.throw()
            expect(() => server.offNotification({[notification]: nonExistingHandler})).to.not.throw()
        })

        it("Do not affects notifications registered under some specific namespaces", async () =>
        {
            const namespaceName = "custom_namespace"
            const namespacedNotification = "specific_notification_for_namespace"
            const namespacedNotificationHandler = spy(noop)
            const {server, client} = await prepareClientAndServer({
                clientOptions: {
                    path: `/${namespaceName}`
                }
            })
            const namespace = server.getOrCreateNamespace(`/${namespaceName}`)
            namespace.onNotification(namespacedNotification, namespacedNotificationHandler)
            server.offNotification(namespacedNotification, namespacedNotificationHandler)
            await new Promise((resolve) =>
            {
                server.onNotification(namespacedNotification, resolve)
                client.send(JSON.stringify({
                    jsonrpc: "2.0",
                    method: namespacedNotification
                }))
            })
            expect(namespacedNotificationHandler).to.have.been.called()
        })
    })
}