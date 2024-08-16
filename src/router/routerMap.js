const constantRouterMap = [
    {
        path: '/',
        redirect: '/computer'
    },
    {
        path: '/computer',
        name: 'Computer',
        component: () => import('@/components/Computer/index.vue')
    },
]

export default constantRouterMap;